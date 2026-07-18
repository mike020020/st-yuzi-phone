import { getContentPresetGeneration, isContentPresetGenerationCurrent } from './mutation-coordinator.js';

const instances = new Map();

export function createContentPresetInstance(sheetKey, routeToken, cleanup) {
    const key = String(sheetKey ?? '').trim();
    const token = `${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const generation = getContentPresetGeneration(key);
    const instance = {
        token, sheetKey: key, routeToken, generation, cleanup, disposed: false,
        isCurrent(activeRouteToken) {
            return !instance.disposed
                && instance.routeToken === activeRouteToken
                && isContentPresetGenerationCurrent(key, generation);
        },
        dispose() {
            if (instance.disposed) return;
            instance.disposed = true;
            try { instance.cleanup?.(); } finally { if (instances.get(key) === instance) instances.delete(key); }
        },
    };
    instances.get(key)?.dispose();
    instances.set(key, instance);
    return instance;
}

export function invalidateContentPresetInstances(sheetKeys = []) {
    for (const key of new Set(sheetKeys.map(String))) instances.get(key)?.dispose();
}
