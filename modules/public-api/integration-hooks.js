import { PublicApiErrorCodes } from './errors.js';

const promptProviders = new Set();
const proactiveProviders = new Set();
const actionHandlers = new Map();

function fail(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhonePublicApiError';
    error.code = code;
    error.details = details;
    throw error;
}

function requireFunction(value, label) {
    if (typeof value !== 'function') fail(`${label} 必须是函数`, PublicApiErrorCodes.INVALID_ARGUMENT, { label });
    return value;
}

function removeFrom(set, value) {
    return set.delete(value);
}

/**
 * 注册提示词上下文 provider；返回只注销本 provider 的 disposer。
 * provider 按注册顺序串行执行，返回 null/undefined 的结果会被忽略，异常会中止本次收集并原样传播。
 * @param {(input: Readonly<object>) => unknown|Promise<unknown>} provider
 * @returns {() => boolean} 注销函数，重复调用返回 false。
 */
export function registerPublicPromptContextProvider(provider) {
    promptProviders.add(requireFunction(provider, 'prompt context provider'));
    return () => removeFrom(promptProviders, provider);
}

/**
 * 注册主动候选 provider；返回只注销本 provider 的 disposer。
 * provider 按注册顺序串行执行，只有数组结果会被展开，异常会中止本次收集并原样传播。
 * @param {(input: Readonly<object>) => Array<object>|Promise<Array<object>>} provider
 * @returns {() => boolean} 注销函数，重复调用返回 false。
 */
export function registerPublicProactiveCandidateProvider(provider) {
    proactiveProviders.add(requireFunction(provider, 'proactive candidate provider'));
    return () => removeFrom(proactiveProviders, provider);
}

/**
 * 注册唯一动作处理器；同一 actionType 不允许重复注册。
 * @param {string} actionType 非空动作类型。
 * @param {(input: Readonly<object>) => unknown|Promise<unknown>} handler
 * @returns {() => boolean} 条件注销函数，只有当前处理器仍为该 handler 时才删除。
 * @throws {YuziPhonePublicApiError} 参数非法或动作已注册时抛出 INVALID_ARGUMENT/ALREADY_REGISTERED。
 */
export function registerPublicActionHandler(actionType, handler) {
    const type = String(actionType || '').trim();
    if (!type) fail('actionType 不能为空', PublicApiErrorCodes.INVALID_ARGUMENT, { actionType });
    if (actionHandlers.has(type)) fail('action handler 已注册', PublicApiErrorCodes.ALREADY_REGISTERED, { actionType: type });
    actionHandlers.set(type, requireFunction(handler, 'action handler'));
    return () => actionHandlers.get(type) === handler && actionHandlers.delete(type);
}

/**
 * 收集所有提示词上下文。输入和返回数组仅做顶层冻结，嵌套对象仍由调用方负责隔离。
 * @param {object} [input] 传给每个 provider 的上下文快照。
 * @returns {Promise<ReadonlyArray<unknown>>}
 */
export async function collectPublicPromptContext(input = {}) {
    const values = [];
    // 先快照集合，使 provider 可以自行注销而不会在本次收集中漏掉或重复；provider
    // 按稳定的注册顺序执行，因为提示词组合可能依赖顺序。
    for (const provider of [...promptProviders]) {
        const value = await provider(Object.freeze({ ...input }));
        if (value !== undefined && value !== null) values.push(value);
    }
    return Object.freeze(values);
}

/**
 * 收集主动候选并复制每个候选的顶层字段，避免调用方改写 provider 返回对象。
 * @param {object} [input] 传给每个 provider 的上下文快照。
 * @returns {Promise<ReadonlyArray<Readonly<object>>>}
 */
export async function collectPublicProactiveCandidates(input = {}) {
    const values = [];
    // 候选项收集同样使用快照规则；返回副本，防止调用方在交付后修改 provider 所有的
    // 候选对象。
    for (const provider of [...proactiveProviders]) {
        const provided = await provider(Object.freeze({ ...input }));
        if (Array.isArray(provided)) values.push(...provided);
    }
    return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

/**
 * 执行动作处理器；输入只做顶层冻结，处理器异常和返回的 Promise 结果原样传播。
 * @param {string} actionType 已注册动作类型。
 * @param {object} [input] 动作输入。
 * @returns {Promise<unknown>}
 * @throws {YuziPhonePublicApiError} 动作未注册时抛出 NOT_FOUND。
 */
export async function executePublicAction(actionType, input = {}) {
    const type = String(actionType || '').trim();
    const handler = actionHandlers.get(type);
    if (!handler) fail('action handler 未注册', PublicApiErrorCodes.NOT_FOUND, { actionType: type });
    // 处理器接收不可变的顶层输入快照；动作路由由扩展独占，因此注册阶段拒绝重复项。
    return handler(Object.freeze({ ...input }));
}

export function destroyPublicIntegrationHooks() {
    // 已销毁手机实例不得保留外部闭包，也不得把后续实例的动作路由到旧实例的处理器。
    promptProviders.clear();
    proactiveProviders.clear();
    actionHandlers.clear();
}
