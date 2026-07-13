import { Logger } from '../../error-handler.js';
import { executeSqlMutationViaApi, probeSqliteCapabilityViaApi, querySqlViaApi } from '../data-api.js';
import { subscribeTableUpdate } from '../callbacks.js';
import { buildSmallCalendarDerivedFieldsAvailabilitySql, buildSmallCalendarDerivedFieldsSignatureSql, buildSmallCalendarDerivedFieldsUpdateSql } from './small-calendar-derived-fields-sql.js';

const defaultLogger = Logger.withScope({ scope: 'phone-core/derived-fields/small-calendar-derived-fields', feature: 'derived-fields' });
const defaultDeps = Object.freeze({
    setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (...args) => globalThis.clearTimeout(...args),
    subscribe: subscribeTableUpdate, probe: probeSqliteCapabilityViaApi, query: querySqlViaApi,
    mutation: executeSqlMutationViaApi, logger: defaultLogger,
});
let deps = { ...defaultDeps };
const MAX_SIGNATURE_RETRY = 1;
const DEBOUNCE_MS = 600;
const PROBE_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);
const QUERY_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);
const MUTATION_RETRY_DELAYS = Object.freeze([2000, 5000]);
const runtime = {
    unsubscribe: null, started: false, generation: 0, debounceTimer: null, probeTimer: null, failureTimer: null,
    probeRetryIndex: 0, failureRetryIndex: 0, failureKind: null, notificationVersion: 0, consumedVersion: 0, running: false,
    lastInputSignature: null, lastInvalidWarningSignature: null, lastProbeErrorKey: null, lastFailureErrorKey: null,
};
function text(value) { return String(value ?? '').trim(); }
function readField(result, name, index) { const row = Array.isArray(result?.rows) ? result.rows[0] : null; if (row && typeof row === 'object' && !Array.isArray(row) && name in row) return row[name]; if (Array.isArray(row)) return row[index]; const values = Array.isArray(result?.values) ? result.values[0] : null; return Array.isArray(values) ? values[index] : ''; }
function current(generation) { return runtime.started && runtime.generation === generation; }
function signature(result) { return { sourceSignature: text(readField(result, 'source_signature', 0)), inputSignature: text(readField(result, 'input_signature', 1)), invalidCount: Number(readField(result, 'invalid_count', 2)) || 0, invalidRowIds: text(readField(result, 'invalid_row_ids', 3)) }; }
function failureKey(result, fallback) { return `${text(result?.code) || fallback}:${text(result?.message) || 'unknown'}`; }
function timeoutMessage(result, fallback) { return text(result?.code).toLowerCase() === 'timeout' || /超时|timeout/i.test(text(result?.message)) ? `${fallback}：结果未确认，底层可能仍在执行` : fallback; }
function warnInvalid(payload, generation) { if (!current(generation)) return; if (!payload?.invalidCount) { runtime.lastInvalidWarningSignature = null; return; } const key = payload.invalidRowIds; if (key === runtime.lastInvalidWarningSignature) return; runtime.lastInvalidWarningSignature = key; deps.logger.warn({ action: 'small-calendar-derived-fields.invalid-date-text', message: '小日历表存在无法解析的“日期”，星期几和月份几天派生将跳过这些行', context: { invalidCount: payload.invalidCount, invalidRowIds: payload.invalidRowIds } }); }
async function querySignature(stage, generation) { const result = await deps.query(buildSmallCalendarDerivedFieldsSignatureSql()); if (!current(generation)) return { status: 'stale-generation' }; if (!result?.ok) { const key = failureKey(result, `signature-${stage}`); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'small-calendar-derived-fields.signature-query-failed', message: timeoutMessage(result, '小日历派生字段输入签名查询失败'), context: { stage, code: result?.code, message: result?.message } }); } return { status: 'query-failed' }; } return { status: 'completed', value: signature(result) }; }
async function runPass(attempt, generation) {
    const availability = await deps.query(buildSmallCalendarDerivedFieldsAvailabilitySql());
    if (!current(generation)) return 'stale-generation';
    if (!availability?.ok) { const key = failureKey(availability, 'availability'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'small-calendar-derived-fields.availability-query-failed', message: timeoutMessage(availability, '小日历派生字段可用性查询失败'), context: { code: availability?.code, message: availability?.message } }); } return 'query-failed'; }
    if (Number(readField(availability, 'is_available', 0)) !== 1) return 'completed';
    const preResult = await querySignature('pre-update', generation); if (preResult.status !== 'completed') return preResult.status; const pre = preResult.value;
    warnInvalid(pre, generation); if (pre.inputSignature === runtime.lastInputSignature) return 'completed';
    const mutation = await deps.mutation(buildSmallCalendarDerivedFieldsUpdateSql());
    if (!current(generation)) return 'stale-generation';
    if (!mutation?.ok) { const key = failureKey(mutation, 'mutation'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'small-calendar-derived-fields.sql-update-failed', message: timeoutMessage(mutation, '小日历派生字段 SQL 批量写入未确认成功'), context: { attempt, code: mutation?.code, message: mutation?.message } }); } return 'mutation-failed'; }
    const postResult = await querySignature('post-update', generation); if (postResult.status !== 'completed') return postResult.status; const post = postResult.value;
    if (post.sourceSignature === pre.sourceSignature) { runtime.lastInputSignature = post.inputSignature; warnInvalid(post, generation); return 'completed'; }
    deps.logger.warn({ action: 'small-calendar-derived-fields.source-changed', message: '小日历派生字段 SQL 写入期间日期源发生变化，将进行有界重试', context: { attempt, maxRetry: MAX_SIGNATURE_RETRY } }); return 'signature-changed';
}
async function runRound(generation) { for (let attempt = 0; attempt <= MAX_SIGNATURE_RETRY; attempt += 1) { const result = await runPass(attempt, generation); if (result !== 'signature-changed') return result; } if (current(generation)) deps.logger.warn({ action: 'small-calendar-derived-fields.retry-exhausted', message: '小日历派生字段 SQL 回填未能在有界重试内确认日期源稳定', context: { maxRetry: MAX_SIGNATURE_RETRY } }); return 'retry-exhausted'; }
function clearTimer(name) { if (runtime[name] !== null) deps.clearTimeout(runtime[name]); runtime[name] = null; }
function scheduleDebounce(generation) { if (!current(generation) || runtime.running || runtime.probeTimer !== null || runtime.failureTimer !== null) return; clearTimer('debounceTimer'); runtime.debounceTimer = deps.setTimeout(() => { runtime.debounceTimer = null; void runRunner(generation); }, DEBOUNCE_MS); }
function scheduleProbeRetry(generation) { if (!current(generation) || runtime.probeRetryIndex >= PROBE_RETRY_DELAYS.length) return false; const delay = PROBE_RETRY_DELAYS[runtime.probeRetryIndex++]; clearTimer('probeTimer'); runtime.probeTimer = deps.setTimeout(() => { runtime.probeTimer = null; void runRunner(generation); }, delay); return true; }
function scheduleFailureRetry(kind, generation) { const delays = kind === 'mutation-failed' ? MUTATION_RETRY_DELAYS : QUERY_RETRY_DELAYS; if (runtime.failureKind !== kind) { runtime.failureKind = kind; runtime.failureRetryIndex = 0; } if (!current(generation) || runtime.failureRetryIndex >= delays.length) return false; const delay = delays[runtime.failureRetryIndex++]; clearTimer('failureTimer'); runtime.failureTimer = deps.setTimeout(() => { runtime.failureTimer = null; void runRunner(generation); }, delay); return true; }
function resetFailureState() { clearTimer('failureTimer'); runtime.failureRetryIndex = 0; runtime.failureKind = null; runtime.lastFailureErrorKey = null; }
async function runRunner(generation) {
    if (!current(generation) || runtime.running) return; runtime.running = true; let rounds = 0; let retryOwnsSchedule = false;
    try {
        while (rounds < 2 && current(generation)) {
            const capturedVersion = runtime.notificationVersion;
            const probe = await deps.probe(); if (!current(generation)) return;
            if (!probe?.ok) {
                const key = failureKey(probe, 'probe');
                if (key !== runtime.lastProbeErrorKey && (text(probe?.code).toLowerCase() === 'timeout' || /超时|timeout/i.test(text(probe?.message)))) { runtime.lastProbeErrorKey = key; deps.logger.warn({ action: 'small-calendar-derived-fields.probe-timeout', message: '小日历 SQLite 能力探测超时：结果未确认，底层可能仍在执行', context: { code: probe?.code, message: probe?.message } }); }
                if (runtime.notificationVersion === capturedVersion) {
                    scheduleProbeRetry(generation); retryOwnsSchedule = true;
                } else {
                    clearTimer('probeTimer');
                }
                return;
            }
            runtime.probeRetryIndex = 0; runtime.lastProbeErrorKey = null;
            const result = await runRound(generation); if (!current(generation) || result === 'stale-generation') return;
            if (result === 'query-failed' || result === 'mutation-failed') {
                if (runtime.notificationVersion === capturedVersion) {
                    scheduleFailureRetry(result, generation); retryOwnsSchedule = true;
                } else {
                    resetFailureState();
                }
                return;
            }
            resetFailureState(); runtime.consumedVersion = capturedVersion; rounds += 1;
            if (runtime.notificationVersion === capturedVersion) break;
        }
    } catch (error) { if (current(generation)) { const result = { code: error?.code, message: error?.message }; const key = failureKey(result, 'runner'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'small-calendar-derived-fields.run-error', message: timeoutMessage(result, '小日历派生字段 SQL 回填失败'), error }); } retryOwnsSchedule = true; scheduleFailureRetry('query-failed', generation); } }
    finally { if (runtime.generation === generation) { runtime.running = false; if (!retryOwnsSchedule && current(generation) && runtime.notificationVersion > runtime.consumedVersion) scheduleDebounce(generation); } }
}
function requestRun() { if (!runtime.started) return; runtime.notificationVersion += 1; runtime.probeRetryIndex = 0; runtime.lastProbeErrorKey = null; resetFailureState(); clearTimer('probeTimer'); if (!runtime.running) scheduleDebounce(runtime.generation); }
export function startSmallCalendarDerivedFieldsInjection() { if (runtime.started) return true; const unsubscribe = deps.subscribe(requestRun); if (typeof unsubscribe !== 'function') return false; runtime.unsubscribe = unsubscribe; runtime.started = true; runtime.generation += 1; requestRun(); return true; }
export function stopSmallCalendarDerivedFieldsInjection() { runtime.generation += 1; runtime.started = false; clearTimer('debounceTimer'); clearTimer('probeTimer'); clearTimer('failureTimer'); if (typeof runtime.unsubscribe === 'function') runtime.unsubscribe(); runtime.unsubscribe = null; runtime.running = false; runtime.probeRetryIndex = 0; runtime.failureRetryIndex = 0; runtime.failureKind = null; runtime.notificationVersion = 0; runtime.consumedVersion = 0; runtime.lastInputSignature = null; runtime.lastInvalidWarningSignature = null; runtime.lastProbeErrorKey = null; runtime.lastFailureErrorKey = null; }
export function __test__setDeps(overrides = {}) { stopSmallCalendarDerivedFieldsInjection(); deps = { ...defaultDeps, ...overrides }; }
export function __test__reset() { stopSmallCalendarDerivedFieldsInjection(); deps = { ...defaultDeps }; }
