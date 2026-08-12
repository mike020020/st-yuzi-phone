import { getContentPresetGeneration, isContentPresetGenerationCurrent } from './mutation-coordinator.js';

const instances = new Map();
const STATES = new Set(['created', 'importing', 'mounting', 'active', 'disposing', 'disposed']);

export function createContentPresetInstance(options = {}) {
    const sheetKey = String(options.sheetKey || '').trim();
    const routeToken = options.routeToken;
    const token = `${sheetKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const generation = (options.getGeneration || getContentPresetGeneration)(sheetKey);
    const isGenerationCurrent = options.isGenerationCurrent || isContentPresetGenerationCurrent;
    const controller = (options.createAbortController || (() => new AbortController()))();
    let state = 'created';
    let authorDisposer = null;
    let disposerCalled = false;
    const callDisposer = (disposer) => {
        if (disposerCalled || typeof disposer !== 'function') return;
        disposerCalled = true;
        try { disposer(); } catch {}
    };
    const instance = {
        token, sheetKey, routeToken, generation, signal: controller.signal,
        get state() { return state; },
        isCurrent(activeRouteToken) {
            return state !== 'disposing' && state !== 'disposed'
                && routeToken === activeRouteToken
                && isGenerationCurrent(sheetKey, generation)
                && (typeof options.isPageOwner !== 'function' || options.isPageOwner());
        },
        transition(nextState) {
            if (!STATES.has(nextState) || state === 'disposing' || state === 'disposed') return false;
            state = nextState;
            return true;
        },
        setAuthorDisposer(disposer) {
            if (typeof disposer !== 'function') return;
            if (state === 'disposing' || state === 'disposed') { callDisposer(disposer); return; }
            authorDisposer = disposer;
        },
        dispose(disposeOptions = {}) {
            if (state === 'disposing' || state === 'disposed') return;
            state = 'disposing';
            try { options.onStopUpdates?.(); } catch {}
            try { controller.abort(); } catch {}
            if (disposeOptions.captureScroll !== false) {
                try { options.onCaptureScroll?.(); } catch {}
            }
            callDisposer(authorDisposer);
            try { options.onHostCleanup?.(); } catch {}
            if (instances.get(sheetKey) === instance) instances.delete(sheetKey);
            state = 'disposed';
        },
    };
    instances.get(sheetKey)?.dispose();
    instances.set(sheetKey, instance);
    return instance;
}

export function invalidateContentPresetInstances(sheetKeys = [], options = {}) {
    for (const key of new Set(sheetKeys.map(String))) instances.get(key)?.dispose(options);
}
