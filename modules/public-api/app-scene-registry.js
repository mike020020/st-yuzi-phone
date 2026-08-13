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

export function registerPublicApp(definition = {}) {
    const appId = asId(definition.appId, 'appId');
    if (apps.has(appId)) {
        throw publicApiError('App 已注册', PublicApiErrorCodes.ALREADY_REGISTERED, { appId });
    }
    const name = String(definition.name || '').trim();
    if (!name) throw publicApiError('App 名称不能为空', PublicApiErrorCodes.INVALID_ARGUMENT, { appId });
    const sceneId = asId(definition.sceneId || appId, 'sceneId');
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

export function unregisterPublicApp(appId) {
    const normalizedAppId = asId(appId, 'appId');
    const app = apps.get(normalizedAppId);
    if (!app) return false;
    apps.delete(normalizedAppId);
    emit('app.unregistered', { app: copyApp(app) });
    return true;
}

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

export async function renderPublicScene(app, route) {
    const scene = scenes.get(app?.sceneId);
    if (!scene) {
        throw publicApiError('App 对应的 Scene 未注册', PublicApiErrorCodes.NOT_FOUND, {
            appId: app?.appId || '',
            sceneId: app?.sceneId || '',
        });
    }
    const view = await scene.render(Object.freeze({
        app: copyApp(app),
        route: String(route || app.route),
    }));
    return Object.freeze({ app: copyApp(app), sceneId: scene.sceneId, view: view && typeof view === 'object' ? { ...view } : {} });
}

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
    for (const sceneId of [...scenes.keys()]) unregisterPublicScene(sceneId);
    for (const appId of [...apps.keys()]) unregisterPublicApp(appId);
    listeners.clear();
}
