const EMPTY = Object.freeze([]);

export function createContentPresetRuntimeContextController(options = {}) {
    let state = options.initialState || null;
    let live = true;
    const listeners = new Set();
    const context = Object.freeze({
        apiVersion: 1,
        root: options.root,
        signal: options.signal,
        actions: options.actions || Object.freeze({}),
        presetAssets: options.presetAssets,
        getState: () => state,
        subscribe(listener) {
            if (typeof listener !== 'function' || !live) return () => {};
            let subscribed = true;
            listeners.add(listener);
            return () => {
                if (!subscribed) return;
                subscribed = false;
                listeners.delete(listener);
            };
        },
        resolveAsset: typeof options.resolveAsset === 'function' ? options.resolveAsset : () => '',
    });
    const publish = (nextState, reason = 'table-data') => {
        if (!live || !nextState || nextState.version === state?.version) return false;
        state = nextState;
        for (const listener of [...listeners]) {
            try { listener(state, { reason: reason === 'navigation-state' ? reason : 'table-data' }); } catch {}
        }
        return true;
    };
    const dispose = () => { live = false; listeners.clear(); };
    return Object.freeze({ context, publish, dispose, getState: () => state, get listeners() { return EMPTY; } });
}

export function createContentPresetRuntimeContext(options = {}) {
    return createContentPresetRuntimeContextController(options).context;
}
