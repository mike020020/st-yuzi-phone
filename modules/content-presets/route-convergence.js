import { getTableData } from '../phone-core/data-api.js';
import { requestCurrentPhoneRouteRender } from '../phone-core/route-runtime.js';
import { getCurrentRoute } from '../phone-core/routing.js';
import { resolveContentPresetRouteTarget } from './route-target.js';

export function resolveCurrentContentPresetSheetKey(options = {}) {
    const readRoute = options.getCurrentRoute || getCurrentRoute;
    const readTableData = options.getTableData || getTableData;
    const target = resolveContentPresetRouteTarget(readRoute(), readTableData());
    return target.bypass ? '' : String(target.sheetKey || '');
}

export function convergeCurrentContentPresetRoute(affectedSheetKeys = [], options = {}) {
    const affected = new Set(affectedSheetKeys.map(String).filter(Boolean));
    const sheetKey = resolveCurrentContentPresetSheetKey(options);
    if (!sheetKey || !affected.has(sheetKey)) return Promise.resolve(false);
    const requestRender = options.requestCurrentPhoneRouteRender || requestCurrentPhoneRouteRender;
    return Promise.resolve(requestRender({ requestMode: 'content-preset-convergence' }));
}
