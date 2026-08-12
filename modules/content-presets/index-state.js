import { Logger } from '../error-handler.js';

const logger = Logger.withScope({ scope: 'content-presets/index-state', feature: 'content-presets' });
const state = {
    status: 'loading', error: null, metadata: new Map(), activeByTable: new Map(), revision: 0,
};
const listeners = new Set();

function emit() {
    const snapshot = getContentPresetIndexSnapshot();
    for (const listener of [...listeners]) {
        try {
            listener(snapshot);
        } catch (error) {
            logger.warn({
                action: 'index.subscriber-error',
                message: '内容预设索引订阅回调执行失败',
                error,
            });
        }
    }
}
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
