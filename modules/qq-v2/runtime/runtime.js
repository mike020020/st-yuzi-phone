function cloneScope(scope) {
    return scope ? { ...scope } : null;
}

function asText(value, maxLength = 1024) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function cloneStoryMessages(messages) {
    if (!Array.isArray(messages)) return Object.freeze([]);
    return Object.freeze(messages.map(message => ({ ...message })));
}

function asEntries(value) {
    if (Array.isArray(value)) return value;
    if (value instanceof Map || value instanceof Set) return Array.from(value.values());
    if (Array.isArray(value?.allActivatedEntries)) return value.allActivatedEntries;
    if (value?.allActivatedEntries instanceof Map || value?.allActivatedEntries instanceof Set) {
        return Array.from(value.allActivatedEntries.values());
    }
    return [];
}

function cloneWorldbookLifecycle(value) {
    if (!value) return null;
    return Object.freeze({
        scope: cloneScope(value.scope),
        entries: Object.freeze(value.entries.map(entry => ({ ...entry }))),
    });
}

/**
 * v2 生命周期壳：后续领域服务只通过它取得当前作用域，避免旧作用域结果落入新聊天。
 */
export function createQQV2Runtime(options = {}) {
    const host = options.host;
    if (!host || typeof host.readScope !== 'function') {
        throw new TypeError('QQ v2 runtime 需要有效的 host adapter');
    }

    const onScopeChanged = typeof options.onScopeChanged === 'function'
        ? options.onScopeChanged
        : () => {};
    const onDestroy = typeof options.onDestroy === 'function'
        ? options.onDestroy
        : () => {};
    const onCharacterMessageRendered = typeof options.onCharacterMessageRendered === 'function'
        ? options.onCharacterMessageRendered
        : () => {};
    const onWorldInfoActivated = typeof options.onWorldInfoActivated === 'function'
        ? options.onWorldInfoActivated
        : () => {};

    let phase = 'idle';
    let activeScope = null;
    let worldbookLifecycle = null;
    let epoch = 0;
    let scopeTransition = Promise.resolve();

    const markHostUnavailable = () => {
        epoch += 1;
        activeScope = null;
        worldbookLifecycle = null;
        phase = 'unavailable';
    };

    const performEnterCurrentScope = async () => {
        if (phase === 'destroyed') return null;
        let nextScope;
        try {
            nextScope = host.readScope();
        } catch (error) {
            if (error?.code === 'host_unavailable') {
                markHostUnavailable();
            }
            throw error;
        }
        const changed = activeScope?.scopeId !== nextScope.scopeId;
        if (changed) {
            worldbookLifecycle = null;
            epoch += 1;
            await onScopeChanged(cloneScope(nextScope), epoch);
            if (phase === 'destroyed') return null;
        }
        activeScope = nextScope;
        return cloneScope(activeScope);
    };

    const enterCurrentScope = () => {
        const task = scopeTransition.then(performEnterCurrentScope, performEnterCurrentScope);
        scopeTransition = task.catch(() => {});
        return task;
    };

    return Object.freeze({
        async initialize() {
            if (phase === 'destroyed') {
                throw new Error('已销毁的 QQ v2 runtime 不能再次初始化');
            }
            const scope = await enterCurrentScope();
            phase = 'ready';
            return scope;
        },
        async handleChatChanged() {
            if (phase === 'destroyed') return null;
            const scope = await enterCurrentScope();
            phase = 'ready';
            return scope;
        },
        async handleCharacterMessageRendered(messageId, generationType) {
            if (phase === 'destroyed') return null;
            const scope = await enterCurrentScope();
            const facts = Object.freeze({
                scope,
                messageId: asText(messageId, 180),
                generationType: asText(generationType, 80),
                storyTime: typeof host.readStoryTime === 'function' ? asText(host.readStoryTime(), 512) : '',
                storyMessages: cloneStoryMessages(
                    typeof host.readStoryMessages === 'function' ? host.readStoryMessages() : [],
                ),
            });
            await onCharacterMessageRendered(facts);
            return facts;
        },
        async handleWorldInfoActivated(entries) {
            if (phase === 'destroyed') return null;
            const scope = await enterCurrentScope();
            worldbookLifecycle = Object.freeze({
                scope,
                entries: Object.freeze(asEntries(entries)
                    .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
                    .map(entry => ({ ...entry }))),
            });
            const facts = cloneWorldbookLifecycle(worldbookLifecycle);
            await onWorldInfoActivated(facts);
            return facts;
        },
        getActiveScope() {
            return cloneScope(activeScope);
        },
        getWorldInfoLifecycle() {
            return cloneWorldbookLifecycle(worldbookLifecycle);
        },
        getStatus() {
            return Object.freeze({
                phase,
                scopeId: activeScope?.scopeId || '',
                worldbookScopeId: worldbookLifecycle?.scope?.scopeId || '',
                epoch,
            });
        },
        destroy() {
            if (phase === 'destroyed') return;
            epoch += 1;
            activeScope = null;
            worldbookLifecycle = null;
            phase = 'destroyed';
            onDestroy();
        },
    });
}
