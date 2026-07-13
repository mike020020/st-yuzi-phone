import { Logger } from '../../error-handler.js';
import { executeSqlMutationViaApi, probeSqliteCapabilityViaApi, querySqlViaApi } from '../data-api.js';
import { subscribeTableUpdate } from '../callbacks.js';
import { CHRONICLE_TODAY_RELATION_ANCHOR_TABLES, buildChronicleTodayRelationSchemaGateSql, buildChronicleTodayRelationSignatureSql, buildChronicleTodayRelationUpdateSql } from './chronicle-today-relation-sql.js';

export const ANCHOR_TABLE_SQL = buildChronicleTodayRelationSchemaGateSql();
export { CHRONICLE_TODAY_RELATION_ANCHOR_TABLES };
const defaultLogger = Logger.withScope({ scope: 'phone-core/derived-fields/chronicle-today-relation', feature: 'derived-fields' });
const defaultDeps = Object.freeze({ setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (...args) => globalThis.clearTimeout(...args), subscribe: subscribeTableUpdate, probe: probeSqliteCapabilityViaApi, query: querySqlViaApi, mutation: executeSqlMutationViaApi, logger: defaultLogger });
let deps = { ...defaultDeps };
const MAX_SIGNATURE_RETRY = 1;
const DEBOUNCE_MS = 600;
const PROBE_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);
const QUERY_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);
const MUTATION_RETRY_DELAYS = Object.freeze([2000, 5000]);
const runtime = { unsubscribe: null, started: false, generation: 0, debounceTimer: null, probeTimer: null, failureTimer: null, probeRetryIndex: 0, failureRetryIndex: 0, failureKind: null, notificationVersion: 0, consumedVersion: 0, running: false, lastInputSignature: null, lastInvalidWarningSignature: null, lastSchemaFingerprint: null, lastProbeErrorKey: null, lastFailureErrorKey: null };
function normalizeText(value) { return String(value ?? '').trim(); }
function readField(result, name, index) { const row = Array.isArray(result?.rows) ? result.rows[0] : null; if (row && typeof row === 'object' && !Array.isArray(row) && name in row) return row[name]; if (Array.isArray(row)) return row[index]; const values = Array.isArray(result?.values) ? result.values[0] : null; return Array.isArray(values) ? values[index] : ''; }
function isCurrent(generation) { return runtime.started && runtime.generation === generation; }
function failureKey(result, fallback) { return `${normalizeText(result?.code) || fallback}:${normalizeText(result?.message) || 'unknown'}`; }
function timeoutMessage(result, fallback) { return normalizeText(result?.code).toLowerCase() === 'timeout' || /超时|timeout/i.test(normalizeText(result?.message)) ? `${fallback}：结果未确认，底层可能仍在执行` : fallback; }
function normalizeInvalidRowIds(value) { return [...new Set(normalizeText(value).split(',').map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(','); }
function normalizeSignature(result) { const invalidRowIds = normalizeInvalidRowIds(readField(result, 'invalid_row_ids', 2)); return { inputSignature: normalizeText(readField(result, 'input_signature', 0)), invalidCount: invalidRowIds ? invalidRowIds.split(',').length : 0, invalidRowIds }; }
function warnInvalid(payload, generation) { if (!isCurrent(generation)) return; if (!payload?.invalidRowIds) { runtime.lastInvalidWarningSignature = null; return; } if (payload.invalidRowIds === runtime.lastInvalidWarningSignature) return; runtime.lastInvalidWarningSignature = payload.invalidRowIds; deps.logger.warn({ action: 'chronicle-today-relation.invalid-time-span', message: '纪要表存在无法解析的“时间跨度”，SQL 派生将跳过这些行', context: { invalidCount: payload.invalidCount, invalidRowIds: payload.invalidRowIds } }); }
async function querySignature(stage, anchorTable, generation) { const result = await deps.query(buildChronicleTodayRelationSignatureSql(anchorTable)); if (!isCurrent(generation)) return { status: 'stale-generation' }; if (!result?.ok) { const key = failureKey(result, `signature-${stage}`); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'chronicle-today-relation.signature-query-failed', message: timeoutMessage(result, '纪要表“与今天的关系”输入签名查询失败'), context: { stage, code: result?.code, message: result?.message } }); } return { status: 'query-failed' }; } return { status: 'completed', value: normalizeSignature(result) }; }
async function runPass(attempt, generation) {
    const gateResult = await deps.query(ANCHOR_TABLE_SQL); if (!isCurrent(generation)) return 'stale-generation'; if (!gateResult?.ok) { const key = failureKey(gateResult, 'schema-gate'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'chronicle-today-relation.schema-query-failed', message: timeoutMessage(gateResult, '纪要表 schema gate 查询失败'), context: { code: gateResult?.code, message: gateResult?.message } }); } return 'query-failed'; }
    const schemaOk = Number(readField(gateResult, 'schema_ok', 0)) === 1; const anchorTable = normalizeText(readField(gateResult, 'anchor_table', 1)); const missingRequirements = normalizeText(readField(gateResult, 'missing_requirements', 2)); const fingerprint = normalizeText(readField(gateResult, 'schema_fingerprint', 3));
    if (!schemaOk || !anchorTable) { if (fingerprint !== runtime.lastSchemaFingerprint) { runtime.lastSchemaFingerprint = fingerprint; deps.logger.warn({ action: 'chronicle-today-relation.schema-blocked', message: '当前纪要表缺少相关字段，已跳过“与今天的关系”自动计算，不影响其他表格功能。', context: { missingRequirements } }); } return 'schema-blocked'; }
    runtime.lastSchemaFingerprint = null;
    const preResult = await querySignature('pre-update', anchorTable, generation); if (preResult.status !== 'completed') return preResult.status; const pre = preResult.value;
    warnInvalid(pre, generation); if (pre.inputSignature === runtime.lastInputSignature) return 'completed';
    const mutation = await deps.mutation(buildChronicleTodayRelationUpdateSql(anchorTable)); if (!isCurrent(generation)) return 'stale-generation';
    if (!mutation?.ok) { const key = failureKey(mutation, 'mutation'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'chronicle-today-relation.sql-update-failed', message: timeoutMessage(mutation, '纪要表“与今天的关系”SQL 批量写入未确认成功'), context: { attempt, code: mutation?.code, message: mutation?.message } }); } return 'mutation-failed'; }
    const postResult = await querySignature('post-update', anchorTable, generation); if (postResult.status !== 'completed') return postResult.status; const post = postResult.value;
    if (post.inputSignature === pre.inputSignature) { runtime.lastInputSignature = post.inputSignature; warnInvalid(post, generation); return 'completed'; }
    deps.logger.warn({ action: 'chronicle-today-relation.signature-changed', message: '纪要表“与今天的关系”SQL 写入期间输入发生变化，将进行有界重试', context: { attempt, maxRetry: MAX_SIGNATURE_RETRY } }); return 'signature-changed';
}
async function runRound(generation) { for (let attempt = 0; attempt <= MAX_SIGNATURE_RETRY; attempt += 1) { const result = await runPass(attempt, generation); if (result !== 'signature-changed') return result; } if (isCurrent(generation)) deps.logger.warn({ action: 'chronicle-today-relation.retry-exhausted', message: '纪要表“与今天的关系”SQL 派生未能在有界重试内确认输入稳定', context: { maxRetry: MAX_SIGNATURE_RETRY } }); return 'retry-exhausted'; }
function clearTimer(name) { if (runtime[name] !== null) deps.clearTimeout(runtime[name]); runtime[name] = null; }
function scheduleDebounce(generation) { if (!isCurrent(generation) || runtime.running || runtime.probeTimer !== null || runtime.failureTimer !== null) return; clearTimer('debounceTimer'); runtime.debounceTimer = deps.setTimeout(() => { runtime.debounceTimer = null; void runRunner(generation); }, DEBOUNCE_MS); }
function scheduleProbeRetry(generation) { if (!isCurrent(generation) || runtime.probeRetryIndex >= PROBE_RETRY_DELAYS.length) return false; const delay = PROBE_RETRY_DELAYS[runtime.probeRetryIndex++]; clearTimer('probeTimer'); runtime.probeTimer = deps.setTimeout(() => { runtime.probeTimer = null; void runRunner(generation); }, delay); return true; }
function scheduleFailureRetry(kind, generation) { const delays = kind === 'mutation-failed' ? MUTATION_RETRY_DELAYS : QUERY_RETRY_DELAYS; if (runtime.failureKind !== kind) { runtime.failureKind = kind; runtime.failureRetryIndex = 0; } if (!isCurrent(generation) || runtime.failureRetryIndex >= delays.length) return false; const delay = delays[runtime.failureRetryIndex++]; clearTimer('failureTimer'); runtime.failureTimer = deps.setTimeout(() => { runtime.failureTimer = null; void runRunner(generation); }, delay); return true; }
function resetFailureState() { clearTimer('failureTimer'); runtime.failureRetryIndex = 0; runtime.failureKind = null; runtime.lastFailureErrorKey = null; }
async function runRunner(generation) {
    if (!isCurrent(generation) || runtime.running) return; runtime.running = true; let rounds = 0; let retryOwnsSchedule = false;
    try {
        while (rounds < 2 && isCurrent(generation)) {
            const capturedVersion = runtime.notificationVersion; const probe = await deps.probe(); if (!isCurrent(generation)) return;
            if (!probe?.ok) {
                const key = failureKey(probe, 'probe');
                if (key !== runtime.lastProbeErrorKey && (normalizeText(probe?.code).toLowerCase() === 'timeout' || /超时|timeout/i.test(normalizeText(probe?.message)))) { runtime.lastProbeErrorKey = key; deps.logger.warn({ action: 'chronicle-today-relation.probe-timeout', message: '纪要 SQLite 能力探测超时：结果未确认，底层可能仍在执行', context: { code: probe?.code, message: probe?.message } }); }
                if (runtime.notificationVersion === capturedVersion) {
                    scheduleProbeRetry(generation); retryOwnsSchedule = true;
                } else {
                    clearTimer('probeTimer');
                }
                return;
            }
            runtime.probeRetryIndex = 0; runtime.lastProbeErrorKey = null;
            const result = await runRound(generation); if (!isCurrent(generation) || result === 'stale-generation') return;
            if (result === 'query-failed' || result === 'mutation-failed') {
                if (runtime.notificationVersion === capturedVersion) {
                    scheduleFailureRetry(result, generation); retryOwnsSchedule = true;
                } else {
                    resetFailureState();
                }
                return;
            }
            resetFailureState(); runtime.consumedVersion = capturedVersion; rounds += 1; if (runtime.notificationVersion === capturedVersion) break;
        }
    } catch (error) { if (isCurrent(generation)) { const result = { code: error?.code, message: error?.message }; const key = failureKey(result, 'runner'); if (key !== runtime.lastFailureErrorKey) { runtime.lastFailureErrorKey = key; deps.logger.warn({ action: 'chronicle-today-relation.run-error', message: timeoutMessage(result, '纪要表“与今天的关系”SQL 派生失败'), error }); } retryOwnsSchedule = true; scheduleFailureRetry('query-failed', generation); } }
    finally { if (runtime.generation === generation) { runtime.running = false; if (!retryOwnsSchedule && isCurrent(generation) && runtime.notificationVersion > runtime.consumedVersion) scheduleDebounce(generation); } }
}
function requestRun() { if (!runtime.started) return; runtime.notificationVersion += 1; runtime.probeRetryIndex = 0; runtime.lastProbeErrorKey = null; resetFailureState(); clearTimer('probeTimer'); if (!runtime.running) scheduleDebounce(runtime.generation); }
export function startChronicleTodayRelationInjection() { if (runtime.started) return true; const unsubscribe = deps.subscribe(requestRun); if (typeof unsubscribe !== 'function') return false; runtime.unsubscribe = unsubscribe; runtime.started = true; runtime.generation += 1; requestRun(); return true; }
export function stopChronicleTodayRelationInjection() { runtime.generation += 1; runtime.started = false; clearTimer('debounceTimer'); clearTimer('probeTimer'); clearTimer('failureTimer'); if (typeof runtime.unsubscribe === 'function') runtime.unsubscribe(); runtime.unsubscribe = null; runtime.running = false; runtime.probeRetryIndex = 0; runtime.failureRetryIndex = 0; runtime.failureKind = null; runtime.notificationVersion = 0; runtime.consumedVersion = 0; runtime.lastInputSignature = null; runtime.lastInvalidWarningSignature = null; runtime.lastSchemaFingerprint = null; runtime.lastProbeErrorKey = null; runtime.lastFailureErrorKey = null; }
export function __test__setDeps(overrides = {}) { stopChronicleTodayRelationInjection(); deps = { ...defaultDeps, ...overrides }; }
export function __test__reset() { stopChronicleTodayRelationInjection(); deps = { ...defaultDeps }; }
