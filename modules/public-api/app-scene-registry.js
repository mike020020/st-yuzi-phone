import { PublicApiErrorCodes } from './errors.js';

const apps = new Map();
const scenes = new Map();
const listeners = new Map();

function publicApiError(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhonePublicApiError';
    error.code = code;
    error.details = details;
    return error;
}

function asId(value, label) {
    const id = String(value || '').trim();
    if (!/^[a-z][a-z0-9._-]{0,95}$/i.test(id)) {
        throw publicApiError(`${label} 无效`, PublicApiErrorCodes.INVALID_ARGUMENT, { label });
    }
    return id;
}

function copyApp(app) {
    // 公开调用方只拿到独立值快照，不取得注册表内部记录的对象身份；后续注销和生命
    // 周期事件仍以注册表当前状态为准。
    return Object.freeze({
        appId: app.appId,
        name: app.name,
        route: app.route,
        sceneId: app.sceneId,
        iconText: app.iconText,
    });
}

function emit(eventName, payload) {
    for (const listener of [...(listeners.get(eventName) || [])]) {
        try {
            listener(Object.freeze({ eventName, ...payload }));
        } catch {
            // Public lifecycle listeners are advisory and must not break the phone.
        }
    }
}

/**
 * 注册一个由公开 API 管理的手机 App。
 * @param {object} definition 定义对象。
 * @param {string} definition.appId 必填，长度不超过 96 且只能使用字母、数字、点、下划线和连字符。
 * @param {string} definition.name 必填，展示名称最多保留 120 个字符。
 * @param {string} [definition.sceneId=definition.appId] 该 App 绑定的 Scene 标识。
 * @param {string} [definition.iconText=definition.name] 首页图标文字，最多保留 12 个字符。
 * @returns {Readonly<{appId:string,name:string,route:string,sceneId:string,iconText:string}>} 独立的 App 快照。
 * @throws {YuziPhonePublicApiError} 参数非法或 appId 已注册时抛出 INVALID_ARGUMENT/ALREADY_REGISTERED。
 */
export function registerPublicApp(definition = {}) {
    const appId = asId(definition.appId, 'appId');
    if (apps.has(appId)) {
        throw publicApiError('App 已注册', PublicApiErrorCodes.ALREADY_REGISTERED, { appId });
    }
    const name = String(definition.name || '').trim();
    if (!name) throw publicApiError('App 名称不能为空', PublicApiErrorCodes.INVALID_ARGUMENT, { appId });
    const sceneId = asId(definition.sceneId || appId, 'sceneId');
    // 公开路由由 appId 推导而不是接受调用方传入，避免侵入手机内置路由命名空间。
    const app = Object.freeze({
        appId,
        name: name.slice(0, 120),
        route: `public-app:${appId}`,
        sceneId,
        iconText: String(definition.iconText || name).trim().slice(0, 12),
    });
    apps.set(appId, app);
    emit('app.registered', { app: copyApp(app) });
    return copyApp(app);
}

/**
 * 注销 App；注销不存在的 App 返回 false，不会抛出 NOT_FOUND。
 * @param {string} appId 已注册的 App 标识。
 * @returns {boolean} 是否确实删除了注册记录。
 */
export function unregisterPublicApp(appId) {
    const normalizedAppId = asId(appId, 'appId');
    const app = apps.get(normalizedAppId);
    if (!app) return false;
    apps.delete(normalizedAppId);
    emit('app.unregistered', { app: copyApp(app) });
    return true;
}

/**
 * 注册一个 Scene。render 是必填异步兼容回调，refresh/destroy 为可选生命周期回调。
 * @param {object} definition 定义对象。
 * @param {string} definition.sceneId 必填 Scene 标识。
 * @param {(input: Readonly<{app:object,route:string}>) => object|Promise<object>} definition.render 渲染回调。
 * @param {(input: Readonly<{sceneId:string}>) => unknown|Promise<unknown>} [definition.refresh] 刷新回调。
 * @param {() => unknown|Promise<unknown>} [definition.destroy] 注销时调用的清理回调。
 * @returns {Readonly<{sceneId:string}>} Scene 标识快照。
 * @throws {YuziPhonePublicApiError} 参数非法或 sceneId 已注册时抛出 INVALID_ARGUMENT/ALREADY_REGISTERED。
 */
export function registerPublicScene(definition = {}) {
    const sceneId = asId(definition.sceneId, 'sceneId');
    if (scenes.has(sceneId)) {
        throw publicApiError('Scene 已注册', PublicApiErrorCodes.ALREADY_REGISTERED, { sceneId });
    }
    if (typeof definition.render !== 'function') {
        throw publicApiError('Scene 必须提供 render 函数', PublicApiErrorCodes.INVALID_ARGUMENT, { sceneId });
    }
    const scene = Object.freeze({
        sceneId,
        render: definition.render,
        refresh: typeof definition.refresh === 'function' ? definition.refresh : null,
        destroy: typeof definition.destroy === 'function' ? definition.destroy : null,
    });
    scenes.set(sceneId, scene);
    emit('scene.registered', { sceneId });
    return Object.freeze({ sceneId });
}

export function unregisterPublicScene(sceneId) {
    const normalizedSceneId = asId(sceneId, 'sceneId');
    const scene = scenes.get(normalizedSceneId);
    if (!scene) return false;
    // 先删除再清理，避免 destroy 钩子渲染或刷新一个已离开手机生命周期的场景。
    scenes.delete(normalizedSceneId);
    try {
        scene.destroy?.();
    } finally {
        emit('scene.unregistered', { sceneId: normalizedSceneId });
    }
    return true;
}

export function listPublicApps() {
    return [...apps.values()].map(copyApp);
}

export function getPublicAppForRoute(route) {
    const match = /^public-app:([a-z0-9._-]+)$/i.exec(String(route || '').trim());
    if (!match) return null;
    return apps.get(match[1]) || null;
}

/**
 * 按 App 当前绑定的 Scene 执行渲染，并返回浅冻结的视图结果。
 * @param {object} app App 快照或包含 sceneId 的注册记录。
 * @param {string} [route] 当前路由；缺省时使用 App 自身路由。
 * @returns {Promise<Readonly<{app:object,sceneId:string,view:object}>>} 渲染结果。
 * @throws {YuziPhonePublicApiError} Scene 不存在时抛出 NOT_FOUND；render 的异常原样传播。
 */
export async function renderPublicScene(app, route) {
    const scene = scenes.get(app?.sceneId);
    if (!scene) {
        throw publicApiError('App 对应的 Scene 未注册', PublicApiErrorCodes.NOT_FOUND, {
            appId: app?.appId || '',
            sceneId: app?.sceneId || '',
        });
    }
    // 不向场景提供注册表对象；场景代码可能在本次渲染后仍保留输入，而注册随时可能
    // 被移除。
    const view = await scene.render(Object.freeze({
        app: copyApp(app),
        route: String(route || app.route),
    }));
    return Object.freeze({ app: copyApp(app), sceneId: scene.sceneId, view: view && typeof view === 'object' ? { ...view } : {} });
}

/**
 * 执行 Scene 的可选 refresh 回调并发出 scene.refreshed 事件。
 * @param {string} sceneId 已注册 Scene 标识。
 * @returns {Promise<unknown>} refresh 返回值；未提供 refresh 时返回 refreshed=true 的快照。
 * @throws {YuziPhonePublicApiError} Scene 不存在时抛出 NOT_FOUND；refresh 的异常原样传播。
 */
export async function refreshPublicScene(sceneId) {
    const normalizedSceneId = asId(sceneId, 'sceneId');
    const scene = scenes.get(normalizedSceneId);
    if (!scene) throw publicApiError('Scene 未注册', PublicApiErrorCodes.NOT_FOUND, { sceneId: normalizedSceneId });
    const result = await scene.refresh?.(Object.freeze({ sceneId: normalizedSceneId }));
    emit('scene.refreshed', { sceneId: normalizedSceneId });
    return result === undefined ? Object.freeze({ sceneId: normalizedSceneId, refreshed: true }) : result;
}

export function addPublicEventListener(eventName, handler) {
    const normalizedEventName = String(eventName || '').trim();
    if (!normalizedEventName || typeof handler !== 'function') {
        throw publicApiError('事件名或处理器无效', PublicApiErrorCodes.INVALID_ARGUMENT);
    }
    const bucket = listeners.get(normalizedEventName) || new Set();
    bucket.add(handler);
    listeners.set(normalizedEventName, bucket);
    return true;
}

export function removePublicEventListener(eventName, handler) {
    const bucket = listeners.get(String(eventName || '').trim());
    if (!bucket || typeof handler !== 'function') return false;
    const deleted = bucket.delete(handler);
    if (bucket.size === 0) listeners.delete(String(eventName || '').trim());
    return deleted;
}

export function destroyPublicAppSceneRegistry() {
    // 场景拥有自己的资源；先注销可确保可选 destroy 钩子在监听器和记录清空前执行。
    for (const sceneId of [...scenes.keys()]) unregisterPublicScene(sceneId);
    for (const appId of [...apps.keys()]) unregisterPublicApp(appId);
    listeners.clear();
}
