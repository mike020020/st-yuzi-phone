import { commitContentPresetIndex, getContentPresetIndexSnapshot } from './index-state.js';

let mutationQueue = Promise.resolve();
const generations = new Map();

export function getContentPresetGeneration(sheetKey) { return generations.get(String(sheetKey)) || 0; }
export function bumpContentPresetGenerations(sheetKeys = []) {
    for (const key of new Set(sheetKeys.map(String).filter(Boolean))) generations.set(key, getContentPresetGeneration(key) + 1);
}
export function isContentPresetGenerationCurrent(sheetKey, generation) { return getContentPresetGeneration(sheetKey) === generation; }

export function enqueueContentPresetMutation(operation, commit, afterCommit) {
    const run = async () => {
        const result = await operation();
        const current = getContentPresetIndexSnapshot();
        const patch = await commit(result, current);
        if (patch?.affectedSheetKeys) bumpContentPresetGenerations(patch.affectedSheetKeys);
        if (patch?.indexPatch) commitContentPresetIndex(patch.indexPatch);
        await afterCommit?.(result, current, patch);
        return result;
    };
    const next = mutationQueue.then(run, run);
    mutationQueue = next.catch(() => {});
    return next;
}
