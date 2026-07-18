import { Logger } from '../../error-handler.js';
import { executeSqlMutationViaApi, probeSqliteCapabilityViaApi, querySqlViaApi } from '../data-api.js';
import { subscribeTableUpdate } from '../callbacks.js';
import { createDerivedFieldService, readDerivedField } from './derived-field-service.js';
import {
    CHRONICLE_TODAY_RELATION_ANCHOR_TABLES,
    buildChronicleTodayRelationSchemaGateSql,
    buildChronicleTodayRelationSignatureSql,
    buildChronicleTodayRelationUpdateSql,
} from './chronicle-today-relation-sql.js';

export const ANCHOR_TABLE_SQL = buildChronicleTodayRelationSchemaGateSql();
export { CHRONICLE_TODAY_RELATION_ANCHOR_TABLES };

const defaultLogger = Logger.withScope({
    scope: 'phone-core/derived-fields/chronicle-today-relation',
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

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeInvalidRowIds(value) {
    return [...new Set(normalizeText(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .join(',');
}

function normalizeSignature(result) {
    const invalidRowIds = normalizeInvalidRowIds(readDerivedField(result, 'invalid_row_ids', 3));
    return {
        sourceSignature: normalizeText(readDerivedField(result, 'source_signature', 0)),
        inputSignature: normalizeText(readDerivedField(result, 'input_signature', 1)),
        invalidCount: invalidRowIds ? invalidRowIds.split(',').length : 0,
        invalidRowIds,
        pendingUpdateCount: Number(readDerivedField(result, 'pending_update_count', 4)) || 0,
    };
}

const service = createDerivedFieldService({
    actionPrefix: 'chronicle-today-relation',
    defaultDeps,
    maxMutationAttempts: 2,
    mutationRetryDelayMs: 2000,
    maxSignatureRetry: 1,
    buildContextSql: () => ANCHOR_TABLE_SQL,
    normalizeContext(result) {
        const schemaOk = Number(readDerivedField(result, 'schema_ok', 0)) === 1;
        const anchorTable = normalizeText(readDerivedField(result, 'anchor_table', 1));
        const missingRequirements = normalizeText(readDerivedField(result, 'missing_requirements', 2));
        const fingerprint = normalizeText(readDerivedField(result, 'schema_fingerprint', 3));

        if (!schemaOk || !anchorTable) {
            return {
                status: 'completed',
                warning: {
                    key: fingerprint || missingRequirements || 'schema-blocked',
                    action: 'chronicle-today-relation.schema-blocked',
                    message: '当前纪要表缺少相关字段，已跳过“与今天的关系”自动计算，不影响其他表格功能',
                    context: { missingRequirements },
                },
            };
        }

        return { status: 'ready', context: { anchorTable } };
    },
    buildSignatureSql: (context) => buildChronicleTodayRelationSignatureSql(context.anchorTable),
    normalizeSignature,
    buildMutationSql: (context) => buildChronicleTodayRelationUpdateSql(context.anchorTable),
    getInvalidWarning(signature) {
        if (!signature?.invalidRowIds) return null;
        return {
            key: signature.invalidRowIds,
            action: 'chronicle-today-relation.invalid-time-span',
            message: '纪要表存在无法解析的“时间跨度”，SQL 派生已跳过这些行',
            context: {
                invalidCount: signature.invalidCount,
                invalidRowIds: signature.invalidRowIds,
            },
        };
    },
    messages: {
        contextQueryFailed: '纪要表 schema gate 查询失败',
        signatureQueryFailed: '纪要表“与今天的关系”输入签名查询失败',
        mutationFailed: '纪要表“与今天的关系”SQL 批量写入未确认成功',
        mutationUnconfirmed: '纪要表派生写入返回成功，但写后仍存在待更新行',
        mutationCircuitOpen: '纪要表同一业务输入已连续写入失败两次，已暂停继续写入，等待时间、聊天或启用状态变化',
        sourceChanged: '纪要表派生写入期间源数据发生变化，将进行一次有界签名重跑',
        signatureRetryExhausted: '纪要表“与今天的关系”未能在有界重跑内确认源数据稳定',
        probeFailed: '纪要 SQLite 能力探测失败，派生字段本轮跳过',
        runError: '纪要表“与今天的关系”SQL 派生异常',
    },
});

export function startChronicleTodayRelationInjection() {
    return service.start();
}

export function stopChronicleTodayRelationInjection() {
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
