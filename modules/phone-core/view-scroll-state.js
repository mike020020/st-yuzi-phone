import {
    captureStableScrollAnchor,
    restoreStableScrollAnchor,
} from './stable-scroll-anchor.js';

const noop = () => {};

function normalizedKey(value) {
    return String(value ?? '').trim();
}

function defaultEnqueue(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return queueMicrotask(callback);
}

function captureOffset(root) {
    return Object.freeze({ mode: 'offset', scrollTop: Math.max(0, Number(root?.scrollTop) || 0) });
}

function restoreOffset(root, snapshot) {
    if (!root || snapshot?.mode !== 'offset') return false;
    const max = Math.max(0, Number(root.scrollHeight || 0) - Number(root.clientHeight || 0));
    root.scrollTop = Math.min(Math.max(0, Number(snapshot.scrollTop) || 0), max);
    return true;
}

export function createPhoneViewScrollState({
    getScopeKey,
    getViewKey,
    enqueue = defaultEnqueue,
} = {}) {
    if (typeof getScopeKey !== 'function' || typeof getViewKey !== 'function') {
        throw new TypeError('Phone view scroll state needs scope and view key readers');
    }

    const registrations = new Map();

    const register = ({
        key,
        matches = () => true,
        getRoot,
        mode = 'offset',
        getItems,
        getKey,
        stickToBottom = true,
    } = {}) => {
        const registrationKey = normalizedKey(key);
        if (!registrationKey || typeof getRoot !== 'function' || !['offset', 'anchor'].includes(mode)) {
            throw new TypeError('Phone view scroll registration is invalid');
        }
        registrations.set(registrationKey, {
            key: registrationKey,
            matches,
            getRoot,
            mode,
            getItems,
            getKey,
            stickToBottom,
        });
        return () => registrations.delete(registrationKey);
    };

    const capture = () => {
        const scopeKey = normalizedKey(getScopeKey());
        const viewKey = normalizedKey(getViewKey());
        if (!scopeKey || !viewKey) return null;

        for (const registration of registrations.values()) {
            if (registration.matches(viewKey) !== true) continue;
            const root = registration.getRoot();
            if (!root) continue;
            const state = registration.mode === 'anchor'
                ? captureStableScrollAnchor(root, registration)
                : captureOffset(root);
            if (!state) continue;
            return Object.freeze({
                scopeKey,
                viewKey,
                registrationKey: registration.key,
                state,
            });
        }
        return null;
    };

    const restore = (snapshot, { token, isCurrent = () => true } = {}) => {
        const registration = registrations.get(normalizedKey(snapshot?.registrationKey));
        if (!registration || typeof enqueue !== 'function') return noop;

        let cancelled = false;
        enqueue(() => {
            if (cancelled || isCurrent(token) !== true) return;
            if (normalizedKey(getScopeKey()) !== snapshot.scopeKey
                || normalizedKey(getViewKey()) !== snapshot.viewKey
                || registration.matches(snapshot.viewKey) !== true) return;
            const root = registration.getRoot();
            if (registration.mode === 'anchor') {
                restoreStableScrollAnchor(root, snapshot.state, registration);
            } else {
                restoreOffset(root, snapshot.state);
            }
        });
        return () => { cancelled = true; };
    };

    return Object.freeze({
        register,
        capture,
        restore,
        dispose() {
            registrations.clear();
        },
    });
}
