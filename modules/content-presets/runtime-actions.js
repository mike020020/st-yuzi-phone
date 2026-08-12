import { navigateBack, navigateTo } from '../phone-core/routing.js';
import { requestTableNavigationSwitch } from '../table-navigation/controls.js';

function result(action, status, fromRoute, extra = {}) {
    return Object.freeze({ ok: status === 'navigated', action, status, fromRoute, ...extra });
}

export function createContentPresetActions(options = {}) {
    const sheetKey = String(options.sheetKey || '').trim();
    const getRoute = typeof options.getRoute === 'function' ? options.getRoute : () => '';
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => false;
    const back = options.navigateBack || navigateBack;
    const navigate = options.navigateTo || navigateTo;
    const switchTable = options.requestTableNavigationSwitch || requestTableNavigationSwitch;
    const pending = new Map();
    const run = (action, execute) => {
        if (pending.has(action)) return pending.get(action);
        const promise = Promise.resolve().then(() => {
            const fromRoute = String(getRoute() || '');
            if (!isCurrent()) return result(action, 'stale', fromRoute);
            return execute(fromRoute);
        }).catch(error => result(action, 'failed', String(getRoute() || ''), { errorCode: 'navigation_failed', message: String(error?.message || error) }))
            .finally(() => pending.delete(action));
        pending.set(action, promise);
        return promise;
    };
    const switchDirection = (action, direction) => run(action, (fromRoute) => {
        const response = switchTable(sheetKey, direction, { isActive: isCurrent });
        if (!response?.navigated) return result(action, response?.reason === 'inactive' ? 'stale' : 'unavailable', fromRoute);
        return result(action, 'navigated', fromRoute, { targetRoute: response.target.route });
    });
    return Object.freeze({
        back: () => run('back', (fromRoute) => {
            const targetRoute = back();
            return result('back', 'navigated', fromRoute, { targetRoute });
        }),
        previousTable: () => switchDirection('previousTable', 'previous'),
        nextTable: () => switchDirection('nextTable', 'next'),
        editCurrentTable: () => run('editCurrentTable', (fromRoute) => {
            const targetRoute = `table-generic:${sheetKey}`;
            navigate(targetRoute);
            return result('editCurrentTable', 'navigated', fromRoute, { targetRoute });
        }),
    });
}
