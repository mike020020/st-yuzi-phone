import { Logger } from '../error-handler.js';
import { getPhoneCoreState, MAX_ROUTE_HISTORY, PHONE_DEFAULT_ROUTE } from './state.js';

const logger = Logger.withScope({ scope: 'phone-core/routing', feature: 'route' });

function pushRouteHistory(route) {
    if (!route || typeof route !== 'string') return;

    const state = getPhoneCoreState();
    state.routeHistory.push({
        route,
        timestamp: Date.now(),
    });

    while (state.routeHistory.length > MAX_ROUTE_HISTORY) {
        state.routeHistory.shift();
    }
}

function emitRouteChange(route, opts = {}) {
    const state = getPhoneCoreState();
    state.onRouteChangeCallbacks.slice().forEach((callback) => {
        try {
            callback(route, opts);
        } catch (error) {
            logger.warn({
                action: 'change.emit',
                message: 'route change callback 执行失败',
                context: {
                    route,
                    isBack: !!opts.isBack,
                },
                error,
            });
        }
    });
}

export function clearRouteHistory() {
    const state = getPhoneCoreState();
    state.routeHistory = [];
}

export function getRouteHistory() {
    return [...getPhoneCoreState().routeHistory];
}

export function getCurrentRoute() {
    return getPhoneCoreState().currentRoute;
}

export function navigateTo(route, opts = {}) {
    const state = getPhoneCoreState();
    const previousRoute = state.currentRoute;
    const pushedHistory = previousRoute !== PHONE_DEFAULT_ROUTE;
    if (pushedHistory) {
        pushRouteHistory(previousRoute);
    }
    state.currentRoute = route;
    emitRouteChange(route, {
        ...opts,
        navigationMode: 'push',
        fromRoute: previousRoute,
        pushedHistory,
        isBack: false,
    });
}

export function navigateToReplacingHistoryTop(route, opts = {}) {
    const state = getPhoneCoreState();
    const displacedHistoryEntry = state.routeHistory.pop() || null;
    if (!displacedHistoryEntry) {
        navigateTo(route, opts);
        return false;
    }

    const previousRoute = state.currentRoute;
    const pushedHistory = previousRoute !== PHONE_DEFAULT_ROUTE;
    if (pushedHistory) {
        pushRouteHistory(previousRoute);
    }
    state.currentRoute = route;
    emitRouteChange(route, {
        ...opts,
        navigationMode: 'push-replace-history-top',
        fromRoute: previousRoute,
        pushedHistory,
        displacedHistoryEntry,
        isBack: false,
    });
    return true;
}

export function replaceCurrentRoute(route, opts = {}) {
    const state = getPhoneCoreState();
    const previousRoute = state.currentRoute;
    state.currentRoute = route;
    emitRouteChange(route, {
        ...opts,
        navigationMode: 'replace',
        fromRoute: previousRoute,
        pushedHistory: false,
        isBack: false,
    });
}

export function navigateBack() {
    const state = getPhoneCoreState();
    const fromRoute = state.currentRoute;
    const lastEntry = state.routeHistory.pop();
    const previousRoute = lastEntry?.route || PHONE_DEFAULT_ROUTE;
    state.currentRoute = previousRoute;
    emitRouteChange(previousRoute, {
        navigationMode: 'back',
        fromRoute,
        pushedHistory: false,
        poppedHistoryEntry: lastEntry || null,
        isBack: true,
    });
    return previousRoute;
}

export function onRouteChange(callback) {
    if (typeof callback !== 'function') return () => {};

    const state = getPhoneCoreState();
    state.onRouteChangeCallbacks.push(callback);

    return () => {
        state.onRouteChangeCallbacks = state.onRouteChangeCallbacks.filter((item) => item !== callback);
    };
}
