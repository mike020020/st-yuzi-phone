import { getTheaterSceneDefinition } from '../phone-theater/config.js';
import { resolveTheaterSceneTables } from '../phone-theater/data.js';
import { resolveTableNavigationTarget } from '../table-navigation/catalog.js';

export function resolveContentPresetRouteTarget(route, rawData) {
    const value = String(route ?? '').trim();
    if (value.startsWith('table-generic:')) return Object.freeze({ bypass: true, route: value, sheetKey: '' });
    if (value.startsWith('table:')) {
        const sheetKey = value.slice('table:'.length).trim();
        const catalogEntry = resolveTableNavigationTarget(rawData, sheetKey);
        return Object.freeze({ bypass: !catalogEntry, route: value, sheetKey, catalogEntry });
    }
    if (value.startsWith('app:')) {
        const requested = value.slice('app:'.length).trim();
        const catalogEntry = resolveTableNavigationTarget(rawData, requested);
        return Object.freeze({ bypass: !catalogEntry, route: value, sheetKey: catalogEntry?.sheetKey || '', catalogEntry });
    }
    if (value.startsWith('theater:')) {
        const sceneId = value.slice('theater:'.length).trim();
        const scene = getTheaterSceneDefinition(sceneId);
        const resolved = resolveTheaterSceneTables(rawData, scene);
        const sheetKey = resolved.primaryTable?.sheetKey || '';
        return Object.freeze({ bypass: !sheetKey, route: value, sheetKey, sceneId, catalogEntry: sheetKey ? resolveTableNavigationTarget(rawData, sheetKey) : null });
    }
    return Object.freeze({ bypass: true, route: value, sheetKey: '' });
}
