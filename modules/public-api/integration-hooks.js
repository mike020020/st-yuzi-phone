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

export function registerPublicPromptContextProvider(provider) {
    promptProviders.add(requireFunction(provider, 'prompt context provider'));
    return () => removeFrom(promptProviders, provider);
}

export function registerPublicProactiveCandidateProvider(provider) {
    proactiveProviders.add(requireFunction(provider, 'proactive candidate provider'));
    return () => removeFrom(proactiveProviders, provider);
}

export function registerPublicActionHandler(actionType, handler) {
    const type = String(actionType || '').trim();
    if (!type) fail('actionType 不能为空', PublicApiErrorCodes.INVALID_ARGUMENT, { actionType });
    if (actionHandlers.has(type)) fail('action handler 已注册', PublicApiErrorCodes.ALREADY_REGISTERED, { actionType: type });
    actionHandlers.set(type, requireFunction(handler, 'action handler'));
    return () => actionHandlers.get(type) === handler && actionHandlers.delete(type);
}

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
