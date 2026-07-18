const state = {
    status: 'loading', error: null, metadata: new Map(), activeByTable: new Map(), revision: 0,
};
const listeners = new Set();

function emit() { for (const listener of [...listeners]) listener(getContentPresetIndexSnapshot()); }
export function getContentPresetIndexSnapshot() {
    return Object.freeze({ status: state.status, error: state.error, metadata: new Map(state.metadata), activeByTable: new Map(state.activeByTable), revision: state.revision });
}
export function subscribeContentPresetIndex(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function commitContentPresetIndex(patch = {}) {
    if (patch.status) state.status = patch.status;
    if ('error' in patch) state.error = patch.error;
    if (patch.metadata) state.metadata = new Map(patch.metadata);
    if (patch.activeByTable) state.activeByTable = new Map(patch.activeByTable);
    state.revision += 1; emit(); return getContentPresetIndexSnapshot();
}
export function markContentPresetIndexUnavailable(error) { return commitContentPresetIndex({ status: 'unavailable', error }); }
export function markContentPresetIndexError(error) { return commitContentPresetIndex({ status: 'error', error }); }
