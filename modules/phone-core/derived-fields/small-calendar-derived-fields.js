import { Logger } from '../../error-handler.js';
import { executeSqlMutationViaApi, probeSqliteCapabilityViaApi, querySqlViaApi } from '../data-api.js';
import { subscribeTableUpdate } from '../callbacks.js';
import { createDerivedFieldService, readDerivedField } from './derived-field-service.js';
import {
    buildSmallCalendarDerivedFieldsAvailabilitySql,
    buildSmallCalendarDerivedFieldsSignatureSql,
    buildSmallCalendarDerivedFieldsUpdateSql,
} from './small-calendar-derived-fields-sql.js';

const defaultLogger = Logger.withScope({
    scope: 'phone-core/derived-fields/small-calendar-derived-fields',
    feature: 'derived-fields',
});

const defaultDeps = Object.freeze({
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    subscribe: subscribeTableUpdate,
    probe: probeSqliteCapabilityViaApi,
    query: querySqlViaApi,
    mutation: executeSqlMutationViaApi,
    logger: defaultLogger,
});

function normalizeSignature(result) {
    return {
        sourceSignature: String(readDerivedField(result, 'source_signature', 0) ?? '').trim(),
        inputSignature: String(readDerivedField(result, 'input_signature', 1) ?? '').trim(),
        invalidCount: Number(readDerivedField(result, 'invalid_count', 2)) || 0,
        invalidRowIds: String(readDerivedField(result, 'invalid_row_ids', 3) ?? '').trim(),
        pendingUpdateCount: Number(readDerivedField(result, 'pending_update_count', 4)) || 0,
    };
}

const service = createDerivedFieldService({
    actionPrefix: 'small-calendar-derived-fields',
    defaultDeps,
    maxMutationAttempts: 2,
    mutationRetryDelayMs: 2000,
    maxSignatureRetry: 1,
    buildContextSql: buildSmallCalendarDerivedFieldsAvailabilitySql,
    normalizeContext(result) {
        return Number(readDerivedField(result, 'is_available', 0)) === 1
            ? { status: 'ready', context: null }
            : { status: 'completed' };
    },
    buildSignatureSql: buildSmallCalendarDerivedFieldsSignatureSql,
    normalizeSignature,
    buildMutationSql: buildSmallCalendarDerivedFieldsUpdateSql,
    getInvalidWarning(signature) {
        if (!signature?.invalidCount) return null;
        return {
            key: signature.invalidRowIds,
            action: 'small-calendar-derived-fields.invalid-date-text',
            message: '小日历表存在无法解析的“日期”，星期几和月份天数派生已跳过这些行',
            context: {
                invalidCount: signature.invalidCount,
                invalidRowIds: signature.invalidRowIds,
            },
        };
    },
    messages: {
        contextQueryFailed: '小日历派生字段可用性查询失败',
        signatureQueryFailed: '小日历派生字段输入签名查询失败',
        mutationFailed: '小日历派生字段 SQL 批量写入未确认成功',
        mutationUnconfirmed: '小日历派生字段写入返回成功，但写后仍存在待更新行',
        mutationCircuitOpen: '小日历同一日期输入已连续写入失败两次，已暂停继续写入，等待日期、聊天或启用状态变化',
        sourceChanged: '小日历派生字段写入期间日期源发生变化，将进行一次有界签名重跑',
        signatureRetryExhausted: '小日历派生字段未能在有界重跑内确认日期源稳定',
        probeFailed: '小日历 SQLite 能力探测失败，派生字段本轮跳过',
        runError: '小日历派生字段 SQL 回填异常',
    },
});

export function startSmallCalendarDerivedFieldsInjection() {
    return service.start();
}

export function stopSmallCalendarDerivedFieldsInjection() {
    service.stop();
}

export function __test__setDeps(overrides = {}) {
    service.setDeps(overrides);
}

export function __test__reset() {
    service.reset();
}

export function __test__getState() {
    return service.getState();
}
