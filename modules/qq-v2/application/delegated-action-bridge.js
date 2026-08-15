import { createActionContext } from '../../public-api/current-scope.js';

const UNSAFE_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function bridgeError(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhoneDelegatedActionError';
    error.code = code;
    error.details = Object.freeze({ ...details });
    return error;
}

function requireScopeHost(scopeHost) {
    if (!scopeHost || typeof scopeHost.getCurrentScope !== 'function') {
        throw bridgeError('scope host 不可用', 'YUZI_SCOPE_UNAVAILABLE');
    }
    return scopeHost;
}

function normalizeActions(actions) {
    const entries = actions instanceof Set
        ? [...actions]
        : Array.isArray(actions)
            ? actions
            : actions && typeof actions === 'object'
                ? Object.keys(actions).filter((actionId) => actions[actionId])
                : [];
    return new Set(entries.map((entry) => String(entry || '').trim()).filter(Boolean));
}

function actionNodeFor(root, target) {
    if (!target || typeof target.closest !== 'function') return null;
    const actionNode = target.closest('[data-action]');
    if (!actionNode || typeof root.contains !== 'function' || !root.contains(actionNode)) return null;
    return actionNode;
}

function fieldValue(field) {
    const type = String(field.type || field.getAttribute?.('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return Boolean(field.checked);
    if (field.value !== undefined) return String(field.value);
    return String(field.getAttribute?.('value') || '');
}

function extractFields(actionNode) {
    const fields = Object.create(null);
    const candidates = [];
    if (actionNode?.hasAttribute?.('data-field')) candidates.push(actionNode);
    for (const field of actionNode?.querySelectorAll?.('[data-field]') || []) candidates.push(field);
    for (const field of candidates) {
        const name = String(field.getAttribute?.('data-field') || '').trim();
        if (!name || UNSAFE_FIELD_NAMES.has(name)) continue;
        fields[name] = fieldValue(field);
    }
    return fields;
}

/**
 * Binds declarative Scene controls to one host-owned action handler. The
 * bridge never resolves identities from markup: action payloads are recreated
 * from the current immutable scope immediately before dispatch.
 */
export function createDelegatedActionBridge({ scopeHost, onAction, sceneId = '' } = {}) {
    const host = requireScopeHost(scopeHost);
    if (typeof onAction !== 'function') {
        throw bridgeError('onAction 必须是函数', 'YUZI_PHONE_API_INVALID_ARGUMENT');
    }
    const normalizedSceneId = String(sceneId || '').trim();
    const actionContext = createActionContext(host);
    let disposed = false;
    let mounted = null;

    const unmount = () => {
        if (!mounted) return false;
        mounted.root.removeEventListener('click', mounted.onClick);
        mounted.root.removeEventListener('submit', mounted.onSubmit);
        mounted = null;
        return true;
    };

    const dispatch = async ({ actionId, payload = {}, revision } = {}) => {
        if (disposed) {
            throw bridgeError('Scene 已销毁', 'YUZI_SCENE_DISPOSED', { sceneId: normalizedSceneId });
        }
        const normalizedActionId = String(actionId || '').trim();
        if (!mounted?.actions.has(normalizedActionId)) {
            throw bridgeError('action 未声明', 'YUZI_ACTION_NOT_DECLARED', { actionId: normalizedActionId });
        }
        const scope = host.getCurrentScope();
        if (revision !== undefined && revision !== scope.revision) {
            throw bridgeError('scope revision 已过期', 'YUZI_SCOPE_STALE', {
                sceneId: normalizedSceneId,
                revision,
                currentRevision: scope.revision,
            });
        }
        const actionPayload = actionContext.withPayload(payload);
        // The check stays adjacent to the handler call so synchronous listeners
        // cannot submit against a scope that was replaced during field handling.
        if (host.getCurrentScope().revision !== scope.revision) {
            throw bridgeError('scope revision 已过期', 'YUZI_SCOPE_STALE', {
                sceneId: normalizedSceneId,
                revision: scope.revision,
                currentRevision: host.getCurrentScope().revision,
            });
        }
        return onAction(Object.freeze({
            scope,
            revision: scope.revision,
            sceneId: normalizedSceneId,
            actionId: normalizedActionId,
            payload: actionPayload,
        }));
    };

    const mount = ({ root, actions, revision } = {}) => {
        if (disposed) {
            throw bridgeError('Scene 已销毁', 'YUZI_SCENE_DISPOSED', { sceneId: normalizedSceneId });
        }
        if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
            throw bridgeError('Scene root 不可用', 'YUZI_PHONE_API_INVALID_ARGUMENT');
        }
        unmount();
        const declaredActions = normalizeActions(actions);
        if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) {
            throw bridgeError('revision 无效', 'YUZI_PHONE_API_INVALID_ARGUMENT', { revision });
        }
        const dispatchEvent = (event) => {
            const actionNode = actionNodeFor(root, event?.target);
            if (!actionNode) return;
            event.preventDefault?.();
            event.yuziActionPromise = dispatch({
                actionId: actionNode.getAttribute?.('data-action'),
                payload: extractFields(actionNode),
                revision,
            });
            // Browser event dispatchers do not await promises. Mark failures as
            // handled while retaining the promise on the event for host tests.
            event.yuziActionPromise.catch(() => {});
        };
        mounted = { root, actions: declaredActions, onClick: dispatchEvent, onSubmit: dispatchEvent };
        root.addEventListener('click', dispatchEvent);
        root.addEventListener('submit', dispatchEvent);
        return Object.freeze({ dispose: unmount });
    };

    return Object.freeze({
        mount,
        dispatch,
        dispose() {
            if (disposed) return false;
            disposed = true;
            unmount();
            return true;
        },
    });
}
