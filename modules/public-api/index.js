/**
 * Yuzi Phone public API foundation.
 *
 * This module deliberately exposes capability metadata instead of leaking UI or
 * runtime modules. New public operations must be added only when implemented.
 */
// 新增 transaction.execute 是向后兼容的公共能力扩展，因此按语义化版本提升 minor。
export const PUBLIC_API_VERSION = '1.1.0';

export { PublicApiErrorCodes } from './errors.js';
import { PublicApiErrorCodes } from './errors.js';
import {
    addPublicEventListener,
    destroyPublicAppSceneRegistry,
    registerPublicApp,
    registerPublicScene,
    removePublicEventListener,
    refreshPublicScene,
    unregisterPublicApp,
    unregisterPublicScene,
} from './app-scene-registry.js';
import { createQQV2PublicMessageRuntime } from '../qq-v2/application/public-message-runtime.js';
import {
    collectPublicProactiveCandidates,
    collectPublicPromptContext,
    destroyPublicIntegrationHooks,
    executePublicAction,
    registerPublicActionHandler,
    registerPublicProactiveCandidateProvider,
    registerPublicPromptContextProvider,
} from './integration-hooks.js';

export const PublicApiCapabilities = Object.freeze({
    VERSION: 'public-api.version',
    CAPABILITIES: 'public-api.capabilities',
    APP_REGISTER: 'app.register',
    SCENE_REGISTER: 'scene.register',
    MESSAGE_IMPORT: 'message.import',
    CONTEXT_READ: 'context.read',
    ACTION_EXECUTE: 'action.execute',
    TRANSACTION_EXECUTE: 'transaction.execute',
});

// 私有标记防止无关扩展伪装成此 API；Symbol.for 让第二份模块副本能够识别
// 已有安装，且不会替换它。
const API_OWNER = Symbol('yuzi-phone.public-api.owner');
const API_OWNER_MARKER = Symbol.for('st-yuzi-phone.public-api.owner');
const PUBLIC_API_PROPERTY = 'YuziPhoneAPI';
// SQL runtime 仅通过函数在调用时取得，不能缓存宿主 API；聊天切换、插件重载后，旧引用
// 可能已经指向被销毁的数据库实例。
let runtimeAdapters = Object.freeze({ navigate: null, refresh: null, getMessageRuntime: null, getSqlApi: null });

const capabilityDefinitions = Object.freeze([
    Object.freeze({ name: PublicApiCapabilities.VERSION, available: true }),
    Object.freeze({ name: PublicApiCapabilities.CAPABILITIES, available: true }),
    Object.freeze({
        name: PublicApiCapabilities.APP_REGISTER,
        available: true,
    }),
    Object.freeze({
        name: PublicApiCapabilities.SCENE_REGISTER,
        available: true,
    }),
    Object.freeze({
        name: PublicApiCapabilities.MESSAGE_IMPORT,
        available: true,
    }),
    Object.freeze({
        name: PublicApiCapabilities.CONTEXT_READ,
        available: true,
    }),
    Object.freeze({
        name: PublicApiCapabilities.ACTION_EXECUTE,
        available: true,
    }),
    Object.freeze({
        name: PublicApiCapabilities.TRANSACTION_EXECUTE,
        available: true,
    }),
]);

function publicApiError(message, code, details = {}) {
    // 与其余 public-api 模块保持同一种可识别错误形状，调用方可只根据 code 显示降级状态。
    const error = new Error(message);
    error.name = 'YuziPhonePublicApiError';
    error.code = code;
    error.details = details;
    return error;
}

function normalizeTransactionStatement(statement, index) {
    // 批处理底层只接收一段 SQL；禁止调用方在单个 statement 中自行拼接第二条语句，
    // 保证每一项均对应一组独立 params，也便于错误精确定位到 statements[index]。
    if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
        throw publicApiError('transaction statement 必须是对象', PublicApiErrorCodes.INVALID_ARGUMENT, { index });
    }
    const sql = String(statement.sql || '').trim();
    if (!sql || sql.includes(';')) {
        throw publicApiError('transaction statement 必须是一条不含分号的 SQL', PublicApiErrorCodes.INVALID_ARGUMENT, { index });
    }
    const params = statement.params === undefined ? [] : statement.params;
    if (!Array.isArray(params)) {
        throw publicApiError('transaction statement params 必须是数组', PublicApiErrorCodes.INVALID_ARGUMENT, { index });
    }
    return { sql, params: params.slice() };
}

function sqlLiteral(value, index, parameterIndex) {
    // executeSqlBatch 没有 params 形参。这里统一将有限类型编码为 SQLite literal，
    // 并对单引号做标准双写，绝不接受对象、数组或 NaN/Infinity 等不可安全序列化的值。
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    throw publicApiError('transaction params 仅支持 null、string、finite number 和 boolean', PublicApiErrorCodes.INVALID_ARGUMENT, { index, parameterIndex });
}

function bindTransactionStatement(statement, index) {
    // 仅替换 SQL 代码区的问号。字符串、双引号标识符、反引号标识符、方括号标识符和
    // 行/块注释里的问号都属于文本，不能被误当作绑定参数，否则会破坏既有 SQL 语义。
    let parameterIndex = 0;
    let state = 'code';
    let sql = '';
    for (let cursor = 0; cursor < statement.sql.length; cursor += 1) {
        const character = statement.sql[cursor];
        const next = statement.sql[cursor + 1];
        if (state === 'code') {
            if (character === "'") state = 'single-quote';
            else if (character === '"') state = 'double-quote';
            else if (character === '`') state = 'backtick';
            else if (character === '[') state = 'bracket';
            else if (character === '-' && next === '-') {
                sql += '--'; cursor += 1; state = 'line-comment'; continue;
            } else if (character === '/' && next === '*') {
                sql += '/*'; cursor += 1; state = 'block-comment'; continue;
            } else if (character === '?') {
                if (parameterIndex >= statement.params.length) {
                    throw publicApiError('transaction statement 参数数量不足', PublicApiErrorCodes.INVALID_ARGUMENT, { index });
                }
                sql += sqlLiteral(statement.params[parameterIndex], index, parameterIndex);
                parameterIndex += 1;
                continue;
            }
        } else if (state === 'single-quote' && character === "'") {
            if (next === "'") {
                sql += "''"; cursor += 1; continue;
            }
            state = 'code';
        } else if (state === 'double-quote' && character === '"') {
            if (next === '"') {
                sql += '""'; cursor += 1; continue;
            }
            state = 'code';
        } else if (state === 'backtick' && character === '`') {
            state = 'code';
        } else if (state === 'bracket' && character === ']') {
            state = 'code';
        } else if (state === 'line-comment' && (character === '\n' || character === '\r')) {
            state = 'code';
        } else if (state === 'block-comment' && character === '*' && next === '/') {
            sql += '*/'; cursor += 1; state = 'code'; continue;
        }
        sql += character;
    }
    if (parameterIndex !== statement.params.length) {
        throw publicApiError('transaction statement 参数数量过多', PublicApiErrorCodes.INVALID_ARGUMENT, { index });
    }
    return sql;
}

function normalizeTransactionOptions(options) {
    // 复制而非透传调用方对象，避免宿主异步提交期间受到外部可变引用影响。
    if (options === undefined) return {};
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw publicApiError('transaction options 必须是对象', PublicApiErrorCodes.INVALID_ARGUMENT);
    }
    return { ...options };
}

async function executePublicSqlTransaction(request = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !Array.isArray(request.statements) || request.statements.length === 0) {
        throw publicApiError('transaction.execute 需要至少一条 statements', PublicApiErrorCodes.INVALID_ARGUMENT);
    }
    const api = runtimeAdapters.getSqlApi?.();
    if (!api || typeof api.executeSqlBatch !== 'function') {
        throw publicApiError('SQLite 原子事务运行时不可用', PublicApiErrorCodes.API_UNAVAILABLE);
    }
    // 先做完全部输入校验，再调用宿主。任何输入错误都不会触发部分 SQL 写入。
    const statements = request.statements.map(normalizeTransactionStatement);
    // shujuku 8.9.2 的 executeSqlBatch 是唯一的多语句表写入提交路径：它在同一事务内
    // 同步 SQLite、运行时投影与聊天保存。参数在进入 batch 前被逐项转为 SQL literal，
    // 因而不会把不可信值拼入未转义的 SQL。
    const result = await api.executeSqlBatch({
        sql: statements.map(bindTransactionStatement).join(';\n'),
        ...normalizeTransactionOptions(request.options),
    });
    if (!result || result.success === false || (Array.isArray(result.errors) && result.errors.length > 0)) {
        throw publicApiError('SQLite 原子事务未提交', PublicApiErrorCodes.API_UNAVAILABLE, { result });
    }
    return result;
}

function copyCapabilities() {
    // 不暴露冻结的源定义；调用方可标注返回副本，不能改变其他调用方的能力检测。
    return capabilityDefinitions.map((capability) => ({ ...capability }));
}

function createPublicApi() {
    const api = {
        getVersion() {
            return PUBLIC_API_VERSION;
        },
        getCapabilities() {
            return copyCapabilities();
        },
        hasCapability(name) {
            return capabilityDefinitions.some((capability) => capability.name === name && capability.available);
        },
        async registerApp(definition) {
            return registerPublicApp(definition);
        },
        async unregisterApp(appId) {
            return unregisterPublicApp(appId);
        },
        async registerScene(definition) {
            return registerPublicScene(definition);
        },
        async unregisterScene(sceneId) {
            return unregisterPublicScene(sceneId);
        },
        async navigate(route) {
            if (typeof runtimeAdapters.navigate !== 'function') {
                throw new Error(PublicApiErrorCodes.API_UNAVAILABLE);
            }
            return runtimeAdapters.navigate(route);
        },
        async refreshScene(sceneId) {
            const result = await refreshPublicScene(sceneId);
            // 先刷新已注册场景，再请求宿主 UI 重绘，使重绘能够读取本次刷新后的场景状态。
            await runtimeAdapters.refresh?.(sceneId);
            return result;
        },
        getMessageRuntime() {
            return createQQV2PublicMessageRuntime({ getRuntime: runtimeAdapters.getMessageRuntime });
        },
        async appendMessage(payload) {
            return this.getMessageRuntime().append(payload);
        },
        async importMessageHistory(payload) {
            return this.getMessageRuntime().importHistory(payload);
        },
        /**
         * Runs parameterized write statements as one shujuku table-write transaction.
         * The transaction boundary is owned by shujuku's executeSqlBatch; this API
         * never falls back to independently committed mutations.
         */
        async executeSqlTransaction(request) {
            // 公共入口只转交给同一份 shujuku batch；不允许退化为多次 executeSqlMutation，
            // 否则业务写入和 externalKey 收据可能出现一条成功、一条失败的部分提交。
            return executePublicSqlTransaction(request);
        },
        registerPromptContextProvider(provider) {
            return registerPublicPromptContextProvider(provider);
        },
        async getPromptContext(input) {
            return collectPublicPromptContext(input);
        },
        registerProactiveCandidateProvider(provider) {
            return registerPublicProactiveCandidateProvider(provider);
        },
        async getProactiveCandidates(input) {
            return collectPublicProactiveCandidates(input);
        },
        registerActionHandler(actionType, handler) {
            return registerPublicActionHandler(actionType, handler);
        },
        async executeAction(actionType, input) {
            return executePublicAction(actionType, input);
        },
        on(eventName, handler) {
            return addPublicEventListener(eventName, handler);
        },
        off(eventName, handler) {
            return removePublicEventListener(eventName, handler);
        },
    };

    Object.defineProperty(api, API_OWNER_MARKER, {
        value: API_OWNER,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    return Object.freeze(api);
}

function isOwnedPublicApi(value) {
    return value?.[API_OWNER_MARKER] === API_OWNER;
}

/**
 * Installs the API once and never replaces a global owned by another extension.
 * @param {Window | typeof globalThis | null | undefined} host
 * @returns {object | null}
 */
export function installYuziPhonePublicApi(host) {
    if (!host || (typeof host !== 'object' && typeof host !== 'function')) return null;

    const existing = host[PUBLIC_API_PROPERTY];
    if (existing) {
        return isOwnedPublicApi(existing) ? existing : null;
    }

    const api = createPublicApi();
    Object.defineProperty(host, PUBLIC_API_PROPERTY, {
        value: api,
        enumerable: true,
        configurable: true,
        writable: false,
    });
    return api;
}

/**
 * Removes only this extension's API object, preserving globals owned elsewhere.
 * @param {Window | typeof globalThis | null | undefined} host
 * @returns {boolean}
 */
export function uninstallYuziPhonePublicApi(host) {
    if (!host || !isOwnedPublicApi(host[PUBLIC_API_PROPERTY])) return false;
    return delete host[PUBLIC_API_PROPERTY];
}

export function configureYuziPhonePublicApiRuntime(adapters = {}) {
    // 每次生命周期启动都整体替换适配器集合；保留缺失回调会在旧手机实例销毁后
    // 意外调用它。
    runtimeAdapters = Object.freeze({
        navigate: typeof adapters.navigate === 'function' ? adapters.navigate : null,
        refresh: typeof adapters.refresh === 'function' ? adapters.refresh : null,
        getMessageRuntime: typeof adapters.getMessageRuntime === 'function' ? adapters.getMessageRuntime : null,
        // 事务 API 使用宿主的 executeSqlBatch，只有该方法存在时 capability 才能实际执行。
        getSqlApi: typeof adapters.getSqlApi === 'function' ? adapters.getSqlApi : null,
    });
}

export function destroyYuziPhonePublicApiRuntime() {
    // 清理注册表时，每个仍在注册的场景只会尝试执行一次 destroy；场景会先从注册表
    // 移除，避免 destroy 钩子重新访问已注销的场景。钩子和适配器不得比手机实例存活更久。
    runtimeAdapters = Object.freeze({ navigate: null, refresh: null, getMessageRuntime: null, getSqlApi: null });
    destroyPublicAppSceneRegistry();
    destroyPublicIntegrationHooks();
}
