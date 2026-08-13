/**
 * Yuzi Phone public API foundation.
 *
 * This module deliberately exposes capability metadata instead of leaking UI or
 * runtime modules. New public operations must be added only when implemented.
 */
export const PUBLIC_API_VERSION = '1.0.0';

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
});

// 私有标记防止无关扩展伪装成此 API；Symbol.for 让第二份模块副本能够识别
// 已有安装，且不会替换它。
const API_OWNER = Symbol('yuzi-phone.public-api.owner');
const API_OWNER_MARKER = Symbol.for('st-yuzi-phone.public-api.owner');
const PUBLIC_API_PROPERTY = 'YuziPhoneAPI';
let runtimeAdapters = Object.freeze({ navigate: null, refresh: null, getMessageRuntime: null });

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
]);

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
            // 先刷新已注册场景，再请求宿主 UI 重绘，确保渲染总能读取场景最新状态。
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
    });
}

export function destroyYuziPhonePublicApiRuntime() {
    // 清理注册表时，每个场景会在注销前恰好执行一次 destroy；钩子和适配器不得
    // 比手机实例存活得更久。
    runtimeAdapters = Object.freeze({ navigate: null, refresh: null, getMessageRuntime: null });
    destroyPublicAppSceneRegistry();
    destroyPublicIntegrationHooks();
}
