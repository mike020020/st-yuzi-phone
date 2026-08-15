const SCOPE_FIELDS = Object.freeze([
    'scopeId',
    'chatId',
    'conversationId',
    'userId',
    'personId',
    'displayName',
    'route',
    'revision',
]);

const IDENTITY_FIELDS = Object.freeze(SCOPE_FIELDS.filter((field) => field !== 'revision'));

function scopeError(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhoneScopeError';
    error.code = code;
    error.details = Object.freeze({ ...details });
    return error;
}

function asNonEmptyText(value, field) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw scopeError(`${field} 不能为空`, 'YUZI_PHONE_API_INVALID_ARGUMENT', { field });
    }
    return text;
}

function asRevision(value) {
    if (!Number.isInteger(value) || value < 0) {
        throw scopeError('revision 必须是非负整数', 'YUZI_PHONE_API_INVALID_ARGUMENT', { revision: value });
    }
    return value;
}

function normalizeScope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw scopeError('WCMHConversationScope 必须是对象', 'YUZI_PHONE_API_INVALID_ARGUMENT');
    }
    const scope = {};
    for (const field of IDENTITY_FIELDS) scope[field] = asNonEmptyText(value[field], field);
    scope.revision = asRevision(value.revision);
    return Object.freeze(scope);
}

function requireScopeHost(scopeHost) {
    if (!scopeHost || typeof scopeHost.getCurrentScope !== 'function') {
        throw scopeError('scope host 不可用', 'YUZI_SCOPE_UNAVAILABLE');
    }
    return scopeHost;
}

/**
 * Creates an isolated owner for the current immutable WCMH conversation scope.
 * A replacement always gets the next local revision, so callers cannot jump or
 * roll back the lifecycle by supplying a revision in their patch.
 */
export function createScopeHost(initialScope) {
    let currentScope = normalizeScope(initialScope);
    const listeners = new Set();

    function emitChanged(previousScope) {
        const event = Object.freeze({
            eventName: 'scope.changed',
            scope: currentScope,
            previousScope,
        });
        for (const listener of [...listeners]) {
            try {
                listener(event);
            } catch {
                // Scope listeners are advisory; they cannot interrupt a host switch.
            }
        }
    }

    return Object.freeze({
        getCurrentScope() {
            return currentScope;
        },
        replaceScope(patch = {}) {
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
                throw scopeError('scope patch 必须是对象', 'YUZI_PHONE_API_INVALID_ARGUMENT');
            }
            if (Object.hasOwn(patch, 'revision')) {
                const requestedRevision = asRevision(patch.revision);
                if (requestedRevision < currentScope.revision) {
                    throw scopeError('scope revision 已过期', 'YUZI_SCOPE_STALE', {
                        currentRevision: currentScope.revision,
                        requestedRevision,
                    });
                }
            }
            const previousScope = currentScope;
            currentScope = normalizeScope({
                ...currentScope,
                ...patch,
                revision: currentScope.revision + 1,
            });
            emitChanged(previousScope);
            return currentScope;
        },
        on(eventName, handler) {
            if (eventName !== 'scope.changed' || typeof handler !== 'function') {
                throw scopeError('scope 事件名或处理器无效', 'YUZI_PHONE_API_INVALID_ARGUMENT', { eventName });
            }
            listeners.add(handler);
            let active = true;
            return () => {
                if (!active) return false;
                active = false;
                return listeners.delete(handler);
            };
        },
        off(eventName, handler) {
            if (eventName !== 'scope.changed' || typeof handler !== 'function') return false;
            return listeners.delete(handler);
        },
    });
}

/**
 * Returns an action context whose payload helper always overwrites caller-owned
 * identity, scope, route, and revision fields with the current host snapshot.
 */
export function createActionContext(scopeHost) {
    const host = requireScopeHost(scopeHost);
    return Object.freeze({
        get scope() {
            return host.getCurrentScope();
        },
        get revision() {
            return host.getCurrentScope().revision;
        },
        withPayload(payload = {}) {
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw scopeError('action payload 必须是对象', 'YUZI_PHONE_API_INVALID_ARGUMENT');
            }
            const scope = host.getCurrentScope();
            return Object.freeze({ ...payload, ...scope });
        },
    });
}

export { SCOPE_FIELDS };
