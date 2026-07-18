import { getPhoneCoreState } from '../phone-core/state.js';
import { commitContentPresetIndex, markContentPresetIndexUnavailable } from './index-state.js';
import { listPresetMetadata, loadActiveBindings } from './repository.js';
import { convergeCurrentContentPresetRoute } from './route-convergence.js';

let startupPromise = null;

export function initializeContentPresetIndex() {
    if (startupPromise) return startupPromise;
    const state = getPhoneCoreState();
    const initialRoute = String(state.currentRoute || '');
    const initialRenderToken = state.routeRenderToken;
    startupPromise = Promise.all([listPresetMetadata(), loadActiveBindings()])
        .then(async ([metadata, activeByTable]) => {
            const snapshot = commitContentPresetIndex({
                status: 'ready',
                error: null,
                metadata: new Map(metadata.map(entry => [entry.id, entry])),
                activeByTable,
            });
            if (String(state.currentRoute || '') === initialRoute && state.routeRenderToken === initialRenderToken) {
                await convergeCurrentContentPresetRoute([...activeByTable.keys()]);
            }
            return snapshot;
        })
        .catch((error) => {
            markContentPresetIndexUnavailable(error);
            return null;
        });
    return startupPromise;
}
