import { Logger } from '../../error-handler.js';
import {
    DEFAULT_API_TIMEOUT,
    callApiWithTimeout,
    callMutationApiToSettlement,
    getDB,
} from '../db-bridge.js';
import { normalizeSqlMutationSettlement } from './mutation-settlement.js';
import { enqueueTableMutation } from './mutation-queue.js';

const logger = Logger.withScope({ scope: 'phone-core/data-api/sql-repository', feature: 'db-api' });

function normalizeSqlInput(sqlOrOptions) {
    if (typeof sqlOrOptions === 'string') return sqlOrOptions.trim();
    if (sqlOrOptions && typeof sqlOrOptions === 'object') {
        return String(sqlOrOptions.sql || '').trim();
    }
    return '';
}

function normalizeParams(params) {
    return Array.isArray(params) ? params : [];
}

function normalizeOptions(options) {
    return options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
}

function normalizeReadDiagnostic(api, methodName, startedAt) {
    if (typeof api?.getLastSqlApiError !== 'function') return null;

    try {
        const diagnostic = api.getLastSqlApiError();
        if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return null;
        if (String(diagnostic.method || '') !== methodName) return null;
        if (!Number.isFinite(Number(diagnostic.at)) || Number(diagnostic.at) < startedAt) return null;

        const code = String(diagnostic.code || '').trim();
        const message = String(diagnostic.message || '').trim();
        if (!code || !message) return null;
        return {
            method: methodName,
            code,
            message,
            at: Number(diagnostic.at),
        };
    } catch {
        return null;
    }
}

function buildFailure(code, message, extra = {}) {
    return {
        ok: false,
        code,
        message,
        result: null,
        rows: [],
        columns: [],
        values: [],
        rowCount: 0,
        errors: [],
        ...extra,
    };
}

function normalizeRows(result) {
    return Array.isArray(result?.rows) ? result.rows : [];
}

function normalizeColumns(result) {
    return Array.isArray(result?.columns) ? result.columns : [];
}

function normalizeValues(result) {
    return Array.isArray(result?.values) ? result.values : [];
}

function normalizeRowCount(result, rows, values) {
    if (Number.isInteger(result?.rowCount) && result.rowCount >= 0) return result.rowCount;
    if (rows.length > 0) return rows.length;
    if (values.length > 0) return values.length;
    return 0;
}

function normalizeQueryResult(result, nullFailure = null) {
    if (result === null) {
        return nullFailure || buildFailure('query_failed', '数据库只读查询返回 null');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return buildFailure('query_failed', 'SQL 查询返回值不是对象', { rawResult: result });
    }
    if ('rows' in result && !Array.isArray(result.rows)) {
        return buildFailure('query_failed', 'SQL 查询 rows 字段不是数组', { result });
    }
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (errors.length > 0) return buildFailure('query_failed', 'SQL 查询返回错误', { result, errors });
    if (result.saved === false) return buildFailure('query_failed', 'SQL 查询未确认保存/读取状态', { result });
    if ('success' in result && result.success === false) return buildFailure('query_failed', 'SQL 查询未确认成功', { result });

    const rows = normalizeRows(result);
    const columns = normalizeColumns(result);
    const values = normalizeValues(result);
    const rowCount = normalizeRowCount(result, rows, values);
    return { ok: true, code: 'ok', result, rows, columns, values, rowCount };
}

export async function querySqlViaApi(sqlOrOptions, params = [], options = {}) {
    const sql = normalizeSqlInput(sqlOrOptions);
    if (!sql) return buildFailure('invalid_sql', 'SQL 查询失败：缺少 SQL');

    const api = getDB();
    if (!api) return buildFailure('api_unavailable', '数据库 API 不可用');

    const querySql = api.querySql;
    const executeSqlQuery = api.executeSqlQuery;
    const methodName = typeof querySql === 'function'
        ? 'querySql'
        : (typeof executeSqlQuery === 'function' ? 'executeSqlQuery' : '');
    const method = methodName === 'querySql' ? querySql : executeSqlQuery;
    if (!methodName) {
        return buildFailure('runtime_not_ready', 'SQLite 只读 runtime 尚未就绪');
    }

    try {
        const startedAt = Date.now();
        const result = await callApiWithTimeout(
            () => method.call(api, sqlOrOptions, normalizeParams(params), normalizeOptions(options)),
            DEFAULT_API_TIMEOUT,
            `querySqlViaApi.${methodName}`,
        );
        const diagnostic = result === null
            ? normalizeReadDiagnostic(api, methodName, startedAt)
            : null;
        return normalizeQueryResult(result, diagnostic
            ? buildFailure(diagnostic.code, diagnostic.message, { sqlApiError: diagnostic })
            : null);
    } catch (error) {
        logger.warn({ action: 'query-sql.error', message: 'SQL 查询调用异常', error });
        return buildFailure('query_failed', error?.message || 'SQL 查询调用异常', { errors: [error] });
    }
}

export async function queryTableRowsViaApi(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return buildFailure('invalid_options', '表格查询失败：options 必须是对象');
    }

    const api = getDB();
    if (!api) return buildFailure('api_unavailable', '数据库 API 不可用');

    const method = api.queryTableRows;
    if (typeof method !== 'function') {
        return buildFailure('runtime_not_ready', 'SQLite 表格只读 runtime 尚未就绪');
    }

    try {
        const startedAt = Date.now();
        const result = await callApiWithTimeout(
            () => method.call(api, normalizeOptions(options)),
            DEFAULT_API_TIMEOUT,
            'queryTableRowsViaApi.queryTableRows',
        );
        const diagnostic = result === null
            ? normalizeReadDiagnostic(api, 'queryTableRows', startedAt)
            : null;
        return normalizeQueryResult(result, diagnostic
            ? buildFailure(diagnostic.code, diagnostic.message, { sqlApiError: diagnostic })
            : null);
    } catch (error) {
        logger.warn({ action: 'query-table-rows.error', message: '表格只读查询调用异常', error });
        return buildFailure('query_failed', error?.message || '表格只读查询调用异常', { errors: [error] });
    }
}

export async function executeSqlMutationViaApi(sqlOrOptions, params = [], options = {}) {
    const sql = normalizeSqlInput(sqlOrOptions);
    if (!sql) return buildFailure('invalid_sql', 'SQL 写入失败：缺少 SQL');

    return enqueueTableMutation('executeSqlMutationViaApi', async () => {
        const api = getDB();
        if (!api) return buildFailure('api_unavailable', '数据库 API 不可用');
        if (typeof api.executeSqlMutation !== 'function') {
            return buildFailure('method_missing', '数据库 API 缺少 executeSqlMutation');
        }

        try {
            const result = await callMutationApiToSettlement(
                () => api.executeSqlMutation(sqlOrOptions, normalizeParams(params), normalizeOptions(options)),
                'executeSqlMutationViaApi.executeSqlMutation',
            );
            const settlement = normalizeSqlMutationSettlement(result);
            return settlement.ok
                ? settlement
                : buildFailure(settlement.code, settlement.message, settlement);
        } catch (error) {
            return buildFailure('mutation_rejected', error?.message || 'SQL 写入 API 调用被拒绝', { errors: [error] });
        }
    });
}
