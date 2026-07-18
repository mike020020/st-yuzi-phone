import { CONTENT_PRESET_CONTEXT_KEY } from './constants.js';

export function createContentPresetRuntimeContext(options = {}) {
    let snapshot = options.snapshot || null;
    const updates = new EventTarget();
    const context = {
        get container() { return options.container; },
        get sheetKey() { return snapshot?.sheetKey || ''; },
        get tableName() { return snapshot?.tableName || ''; },
        get headers() { return snapshot?.headers || Object.freeze([]); },
        get rows() { return snapshot?.rows || Object.freeze([]); },
        get snapshot() { return snapshot; },
        route: String(options.route || ''),
        token: String(options.token || ''),
        resolveAsset: options.resolveAsset,
        updates,
    };
    Object.defineProperty(context, 'replaceSnapshot', {
        value(nextSnapshot) { snapshot = nextSnapshot; updates.dispatchEvent(new CustomEvent('update', { detail: nextSnapshot })); },
        enumerable: false,
    });
    return Object.freeze(context);
}

export function registerContentPresetContext(context) {
    const host = globalThis.window || globalThis;
    const registry = host[CONTENT_PRESET_CONTEXT_KEY] instanceof Map ? host[CONTENT_PRESET_CONTEXT_KEY] : new Map();
    host[CONTENT_PRESET_CONTEXT_KEY] = registry;
    registry.set(context.token, context);
    host.__YUZI_BEAUTIFY_CURRENT_CONTEXT__ = context;
    let cleaned = false;
    return () => {
        if (cleaned) return;
        cleaned = true;
        registry.delete(context.token);
        if (host.__YUZI_BEAUTIFY_CURRENT_CONTEXT__ === context) {
            const remaining = [...registry.values()];
            const previous = remaining[remaining.length - 1];
            if (previous) host.__YUZI_BEAUTIFY_CURRENT_CONTEXT__ = previous;
            else delete host.__YUZI_BEAUTIFY_CURRENT_CONTEXT__;
        }
        if (registry.size === 0) delete host[CONTENT_PRESET_CONTEXT_KEY];
    };
}
