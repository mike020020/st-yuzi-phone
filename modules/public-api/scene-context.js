let nextRenderToken = 0;

function sceneError(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhoneSceneError';
    error.code = code;
    error.details = Object.freeze({ ...details });
    return error;
}

function requireScopeHost(scopeHost) {
    if (!scopeHost || typeof scopeHost.getCurrentScope !== 'function' || typeof scopeHost.on !== 'function') {
        throw sceneError('scope host 不可用', 'YUZI_SCOPE_UNAVAILABLE');
    }
    return scopeHost;
}

/**
 * Captures one render against one scope revision. A scope change aborts the
 * pending render; dispose also detaches the listener so old scenes cannot keep
 * observing future conversations.
 */
export function createRenderContext(scopeHost, sceneId) {
    const host = requireScopeHost(scopeHost);
    const normalizedSceneId = String(sceneId || '').trim();
    if (!normalizedSceneId) {
        throw sceneError('sceneId 不能为空', 'YUZI_PHONE_API_INVALID_ARGUMENT');
    }

    const scope = host.getCurrentScope();
    const abortController = new AbortController();
    const renderToken = `${normalizedSceneId}:${++nextRenderToken}`;
    let disposed = false;
    let unsubscribe = null;

    const stopListening = () => {
        if (!unsubscribe) return false;
        const disposeListener = unsubscribe;
        unsubscribe = null;
        return disposeListener();
    };
    const invalidate = () => {
        stopListening();
        if (!abortController.signal.aborted) abortController.abort();
    };

    unsubscribe = host.on('scope.changed', () => invalidate());

    function isCurrent(revision) {
        if (disposed || abortController.signal.aborted || revision !== scope.revision) return false;
        return host.getCurrentScope().revision === scope.revision;
    }

    return Object.freeze({
        sceneId: normalizedSceneId,
        scope,
        revision: scope.revision,
        route: scope.route,
        renderToken,
        abortController,
        abortSignal: abortController.signal,
        isCurrent,
        assertCurrentRevision(revision) {
            if (disposed) {
                throw sceneError('Scene 已销毁', 'YUZI_SCENE_DISPOSED', { sceneId: normalizedSceneId });
            }
            if (!isCurrent(revision)) {
                throw sceneError('scope revision 已过期', 'YUZI_SCOPE_STALE', {
                    sceneId: normalizedSceneId,
                    expectedRevision: scope.revision,
                    revision,
                    currentRevision: host.getCurrentScope().revision,
                });
            }
            return scope;
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            stopListening();
            if (!abortController.signal.aborted) abortController.abort();
            return true;
        },
    });
}
