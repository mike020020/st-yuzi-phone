const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_AVAILABILITY_RETRY_MS = 1000;
const DEFAULT_QUERY_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);
const DEFAULT_MUTATION_RETRY_DELAY_MS = 2000;
const DEFAULT_MAX_MUTATION_ATTEMPTS = 2;
const DEFAULT_MAX_SIGNATURE_RETRY = 1;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function failureKey(result, fallback) {
    return `${normalizeText(result?.code) || fallback}:${normalizeText(result?.message) || 'unknown'}`;
}

function cloneDelays(value, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    return source
        .map((delay) => Number(delay))
        .filter((delay) => Number.isFinite(delay) && delay >= 0)
        .map((delay) => Math.round(delay));
}

export function readDerivedField(result, name, index) {
    const row = Array.isArray(result?.rows) ? result.rows[0] : null;
    if (row && typeof row === 'object' && !Array.isArray(row) && name in row) {
        return row[name];
    }
    if (Array.isArray(row)) {
        return row[index];
    }
    const values = Array.isArray(result?.values) ? result.values[0] : null;
    return Array.isArray(values) ? values[index] : '';
}

export function createDerivedFieldService(config = {}) {
    const defaultDeps = Object.freeze({ ...(config.defaultDeps || {}) });
    let deps = { ...defaultDeps };
    const actionPrefix = normalizeText(config.actionPrefix) || 'derived-fields';
    const debounceMs = Number.isFinite(Number(config.debounceMs))
        ? Math.max(0, Math.round(Number(config.debounceMs)))
        : DEFAULT_DEBOUNCE_MS;
    const availabilityRetryMs = Number.isFinite(Number(config.availabilityRetryMs))
        ? Math.max(0, Math.round(Number(config.availabilityRetryMs)))
        : DEFAULT_AVAILABILITY_RETRY_MS;
    const queryRetryDelays = cloneDelays(config.queryRetryDelays, DEFAULT_QUERY_RETRY_DELAYS);
    const mutationRetryDelayMs = Number.isFinite(Number(config.mutationRetryDelayMs))
        ? Math.max(0, Math.round(Number(config.mutationRetryDelayMs)))
        : DEFAULT_MUTATION_RETRY_DELAY_MS;
    const maxMutationAttempts = Number.isFinite(Number(config.maxMutationAttempts))
        ? Math.max(1, Math.round(Number(config.maxMutationAttempts)))
        : DEFAULT_MAX_MUTATION_ATTEMPTS;
    const maxSignatureRetry = Number.isFinite(Number(config.maxSignatureRetry))
        ? Math.max(0, Math.round(Number(config.maxSignatureRetry)))
        : DEFAULT_MAX_SIGNATURE_RETRY;

    const runtime = {
        unsubscribeUpdate: null,
        unsubscribeFillStart: null,
        started: false,
        generation: 0,
        debounceTimer: null,
        availabilityTimer: null,
        queryRetryTimer: null,
        mutationRetryTimer: null,
        queryRetryIndex: 0,
        notificationVersion: 0,
        consumedVersion: 0,
        running: false,
        fillActive: false,
        lastInputSignature: null,
        lastInvalidWarningSignature: null,
        lastContextWarningSignature: null,
        lastFailureErrorKey: null,
        mutationSourceSignature: null,
        mutationAttempts: 0,
        mutationCircuitOpen: false,
        pendingConfirmationSourceSignature: null,
        lastCircuitWarningSignature: null,
    };

    function isCurrent(generation) {
        return runtime.started && runtime.generation === generation;
    }

    function warnLifecycle(action, message, context = {}, error = undefined) {
        try {
            deps.logger?.warn?.({ action, message, context, error });
        } catch {
            // 生命周期清理不能被日志实现反向打断。
        }
    }

    function clearTimer(name) {
        const timerId = runtime[name];
        runtime[name] = null;
        if (timerId === null) return;
        try {
            deps.clearTimeout(timerId);
        } catch (error) {
            warnLifecycle(
                `${actionPrefix}.timer-clear-failed`,
                '派生字段定时器清理失败',
                { timer: name },
                error,
            );
        }
    }

    function hasRetryTimer() {
        return runtime.availabilityTimer !== null
            || runtime.queryRetryTimer !== null
            || runtime.mutationRetryTimer !== null;
    }

    function warnOnce(result, fallbackKey, payload) {
        const key = failureKey(result, fallbackKey);
        if (key === runtime.lastFailureErrorKey) return;
        runtime.lastFailureErrorKey = key;
        deps.logger.warn(payload);
    }

    function warnInvalid(signature, generation) {
        if (!isCurrent(generation) || typeof config.getInvalidWarning !== 'function') return;
        const warning = config.getInvalidWarning(signature);
        const key = normalizeText(warning?.key);
        if (!key) {
            runtime.lastInvalidWarningSignature = null;
            return;
        }
        if (key === runtime.lastInvalidWarningSignature) return;
        runtime.lastInvalidWarningSignature = key;
        deps.logger.warn({
            action: warning.action || `${actionPrefix}.invalid-input`,
            message: warning.message || '派生字段输入包含无法解析的值，已跳过对应行',
            context: warning.context,
        });
    }

    function warnContext(result) {
        const warning = result?.warning;
        if (!warning) {
            runtime.lastContextWarningSignature = null;
            return;
        }
        const key = normalizeText(warning.key) || `${warning.action || 'context'}:${warning.message || ''}`;
        if (key === runtime.lastContextWarningSignature) return;
        runtime.lastContextWarningSignature = key;
        deps.logger.warn({
            action: warning.action || `${actionPrefix}.context-blocked`,
            message: warning.message || '派生字段运行条件不满足，已跳过',
            context: warning.context,
        });
    }

    function alignMutationBudget(sourceSignature) {
        const source = normalizeText(sourceSignature);
        if (runtime.mutationSourceSignature === source) return;
        runtime.mutationSourceSignature = source;
        runtime.mutationAttempts = 0;
        runtime.mutationCircuitOpen = false;
        runtime.pendingConfirmationSourceSignature = null;
        runtime.lastCircuitWarningSignature = null;
        clearTimer('mutationRetryTimer');
    }

    function markMutationConfirmed(sourceSignature) {
        alignMutationBudget(sourceSignature);
        runtime.pendingConfirmationSourceSignature = null;
        runtime.lastCircuitWarningSignature = null;
        clearTimer('mutationRetryTimer');
    }

    function beginMutationAttempt(sourceSignature) {
        alignMutationBudget(sourceSignature);
        if (runtime.mutationCircuitOpen || runtime.mutationAttempts >= maxMutationAttempts) {
            runtime.mutationCircuitOpen = true;
            return false;
        }
        runtime.mutationAttempts += 1;
        return true;
    }

    function markMutationFailed(sourceSignature) {
        alignMutationBudget(sourceSignature);
        if (runtime.mutationAttempts >= maxMutationAttempts) {
            runtime.mutationCircuitOpen = true;
            return false;
        }
        return true;
    }

    function warnMutationCircuit(sourceSignature) {
        const source = normalizeText(sourceSignature);
        if (runtime.lastCircuitWarningSignature === source) return;
        runtime.lastCircuitWarningSignature = source;
        deps.logger.warn({
            action: `${actionPrefix}.mutation-circuit-open`,
            message: config.messages?.mutationCircuitOpen || '同一业务输入的派生写入已连续失败两次，已暂停继续写入，等待输入或聊天上下文变化',
            context: {
                sourceSignature: source,
                attempts: runtime.mutationAttempts,
                maxAttempts: maxMutationAttempts,
            },
        });
    }

    async function loadContext(generation) {
        if (typeof config.resolveContext === 'function') {
            const normalized = await config.resolveContext(deps, {
                shouldPause: () => runtime.fillActive || !isCurrent(generation),
            });
            if (!isCurrent(generation)) return { status: 'stale-generation' };
            if (normalized?.status === 'runtime-not-ready') return normalized;
            if (normalized?.status === 'query-failed') {
                const failure = normalized.result || normalized;
                warnOnce(failure, 'context-query', {
                    action: `${actionPrefix}.context-query-failed`,
                    message: config.messages?.contextQueryFailed || '派生字段运行条件查询失败',
                    context: { code: failure?.code, message: failure?.message },
                });
                return normalized;
            }
            warnContext(normalized);
            return normalized?.status ? normalized : { status: 'completed' };
        }

        const result = await deps.query(config.buildContextSql());
        if (!isCurrent(generation)) return { status: 'stale-generation' };
        if (result?.code === 'runtime_not_ready') return { status: 'runtime-not-ready' };
        if (!result?.ok) {
            warnOnce(result, 'context-query', {
                action: `${actionPrefix}.context-query-failed`,
                message: config.messages?.contextQueryFailed || '派生字段运行条件查询失败',
                context: { code: result?.code, message: result?.message },
            });
            return { status: 'query-failed' };
        }

        const normalized = typeof config.normalizeContext === 'function'
            ? config.normalizeContext(result)
            : { status: 'ready', context: null };
        warnContext(normalized);
        return normalized?.status ? normalized : { status: 'completed' };
    }

    async function querySignature(stage, context, generation) {
        const result = await deps.query(config.buildSignatureSql(context));
        if (!isCurrent(generation)) return { status: 'stale-generation' };
        if (result?.code === 'runtime_not_ready') return { status: 'runtime-not-ready' };
        if (!result?.ok) {
            warnOnce(result, `signature-${stage}`, {
                action: `${actionPrefix}.signature-query-failed`,
                message: config.messages?.signatureQueryFailed || '派生字段签名查询失败',
                context: { stage, code: result?.code, message: result?.message },
            });
            return { status: 'query-failed' };
        }

        const value = config.normalizeSignature(result);
        return {
            status: 'completed',
            value: {
                ...value,
                sourceSignature: normalizeText(value?.sourceSignature),
                inputSignature: normalizeText(value?.inputSignature),
                pendingUpdateCount: normalizeCount(value?.pendingUpdateCount),
            },
        };
    }

    async function runPass(attempt, generation) {
        if (runtime.fillActive) return 'fill-active';
        const contextResult = await loadContext(generation);
        if (contextResult.status !== 'ready') return contextResult.status;
        const context = contextResult.context;

        if (runtime.fillActive) return 'fill-active';
        const preResult = await querySignature('pre-update', context, generation);
        if (preResult.status !== 'completed') return preResult.status;
        const pre = preResult.value;
        warnInvalid(pre, generation);
        alignMutationBudget(pre.sourceSignature);

        if (pre.pendingUpdateCount === 0) {
            runtime.lastInputSignature = pre.inputSignature;
            markMutationConfirmed(pre.sourceSignature);
            return 'completed';
        }

        if (runtime.pendingConfirmationSourceSignature === pre.sourceSignature) {
            runtime.pendingConfirmationSourceSignature = null;
            const unconfirmed = {
                code: 'mutation_result_unconfirmed',
                message: `写入已完成，但确认查询仍显示 ${pre.pendingUpdateCount} 行待更新`,
            };
            warnOnce(unconfirmed, 'mutation-unconfirmed', {
                action: `${actionPrefix}.sql-update-unconfirmed`,
                message: config.messages?.mutationUnconfirmed || '派生字段写入已完成，但确认查询仍显示存在待更新行',
                context: {
                    attempt,
                    mutationAttempt: runtime.mutationAttempts,
                    sourceSignature: pre.sourceSignature,
                    pendingUpdateCount: pre.pendingUpdateCount,
                    confirmationOnly: true,
                },
            });
            return { status: 'mutation-failed', sourceSignature: pre.sourceSignature };
        }

        if (runtime.mutationCircuitOpen) {
            warnMutationCircuit(pre.sourceSignature);
            return 'mutation-blocked';
        }

        if (runtime.fillActive) return 'fill-active';
        if (!beginMutationAttempt(pre.sourceSignature)) {
            warnMutationCircuit(pre.sourceSignature);
            return 'mutation-blocked';
        }

        let mutation;
        try {
            mutation = await deps.mutation(config.buildMutationSql(context));
        } catch (error) {
            if (!isCurrent(generation)) return 'stale-generation';
            const rejected = {
                code: error?.code || 'mutation_rejected',
                message: error?.message || String(error),
            };
            warnOnce(rejected, 'mutation-rejected', {
                action: `${actionPrefix}.sql-update-failed`,
                message: config.messages?.mutationFailed || '派生字段 SQL 写入未确认成功',
                context: {
                    attempt,
                    mutationAttempt: runtime.mutationAttempts,
                    maxMutationAttempts,
                    sourceSignature: pre.sourceSignature,
                    code: rejected.code,
                    message: rejected.message,
                },
                error,
            });
            return { status: 'mutation-failed', sourceSignature: pre.sourceSignature };
        }
        if (!isCurrent(generation)) return 'stale-generation';
        if (!mutation?.ok) {
            warnOnce(mutation, 'mutation', {
                action: `${actionPrefix}.sql-update-failed`,
                message: config.messages?.mutationFailed || '派生字段 SQL 写入未确认成功',
                context: {
                    attempt,
                    mutationAttempt: runtime.mutationAttempts,
                    maxMutationAttempts,
                    sourceSignature: pre.sourceSignature,
                    code: mutation?.code,
                    message: mutation?.message,
                },
            });
            return { status: 'mutation-failed', sourceSignature: pre.sourceSignature };
        }

        runtime.pendingConfirmationSourceSignature = pre.sourceSignature;
        if (runtime.fillActive) return 'fill-active';
        const postResult = await querySignature('post-update', context, generation);
        if (postResult.status !== 'completed') return postResult.status;
        const post = postResult.value;
        warnInvalid(post, generation);

        if (post.sourceSignature === pre.sourceSignature && post.pendingUpdateCount === 0) {
            runtime.lastInputSignature = post.inputSignature;
            markMutationConfirmed(post.sourceSignature);
            return 'completed';
        }

        if (post.sourceSignature === pre.sourceSignature) {
            runtime.pendingConfirmationSourceSignature = null;
            const unconfirmed = {
                code: 'mutation_result_unconfirmed',
                message: `写入返回成功，但仍有 ${post.pendingUpdateCount} 行待更新`,
            };
            warnOnce(unconfirmed, 'mutation-unconfirmed', {
                action: `${actionPrefix}.sql-update-unconfirmed`,
                message: config.messages?.mutationUnconfirmed || '派生字段写入返回成功，但写后签名仍显示存在待更新行',
                context: {
                    attempt,
                    mutationAttempt: runtime.mutationAttempts,
                    sourceSignature: pre.sourceSignature,
                    pendingUpdateCount: post.pendingUpdateCount,
                },
            });
            return { status: 'mutation-failed', sourceSignature: pre.sourceSignature };
        }

        runtime.pendingConfirmationSourceSignature = null;
        deps.logger.warn({
            action: `${actionPrefix}.source-changed`,
            message: config.messages?.sourceChanged || '派生字段写入期间源数据发生变化，将进行一次有界签名重跑',
            context: { attempt, maxRetry: maxSignatureRetry },
        });
        return 'signature-changed';
    }

    async function runRound(generation) {
        for (let attempt = 0; attempt <= maxSignatureRetry; attempt += 1) {
            const result = await runPass(attempt, generation);
            if (result !== 'signature-changed') return result;
        }
        if (isCurrent(generation)) {
            deps.logger.warn({
                action: `${actionPrefix}.signature-retry-exhausted`,
                message: config.messages?.signatureRetryExhausted || '派生字段未能在有界重跑内确认源数据稳定',
                context: { maxRetry: maxSignatureRetry },
            });
        }
        return 'retry-exhausted';
    }

    function scheduleDebounce(generation) {
        if (!isCurrent(generation) || runtime.fillActive || runtime.running || hasRetryTimer()) return false;
        clearTimer('debounceTimer');
        runtime.debounceTimer = deps.setTimeout(() => {
            runtime.debounceTimer = null;
            void runRunner(generation);
        }, debounceMs);
        return true;
    }

    function scheduleAvailabilityRetry(generation) {
        if (!isCurrent(generation) || runtime.fillActive || runtime.availabilityTimer !== null) return false;
        runtime.availabilityTimer = deps.setTimeout(() => {
            runtime.availabilityTimer = null;
            void runRunner(generation);
        }, availabilityRetryMs);
        return true;
    }

    function scheduleQueryRetry(generation) {
        if (!isCurrent(generation) || runtime.queryRetryIndex >= queryRetryDelays.length) return false;
        const delay = queryRetryDelays[runtime.queryRetryIndex++];
        clearTimer('queryRetryTimer');
        runtime.queryRetryTimer = deps.setTimeout(() => {
            runtime.queryRetryTimer = null;
            void runRunner(generation);
        }, delay);
        return true;
    }

    function scheduleMutationRetry(sourceSignature, generation) {
        if (!isCurrent(generation) || !markMutationFailed(sourceSignature)) return false;
        clearTimer('mutationRetryTimer');
        runtime.mutationRetryTimer = deps.setTimeout(() => {
            runtime.mutationRetryTimer = null;
            void runRunner(generation);
        }, mutationRetryDelayMs);
        return true;
    }

    function clearReadFailureState() {
        clearTimer('queryRetryTimer');
        runtime.queryRetryIndex = 0;
        runtime.lastFailureErrorKey = null;
    }

    async function runRunner(generation) {
        if (!isCurrent(generation) || runtime.running || runtime.fillActive) return;
        runtime.running = true;
        let rounds = 0;

        try {
            while (rounds < 2 && isCurrent(generation)) {
                const capturedVersion = runtime.notificationVersion;
                const result = await runRound(generation);
                if (!isCurrent(generation) || result === 'stale-generation') return;

                const status = typeof result === 'string' ? result : result?.status;
                if (status === 'runtime-not-ready') {
                    scheduleAvailabilityRetry(generation);
                    runtime.consumedVersion = capturedVersion;
                    return;
                }

                if (status === 'fill-active') {
                    runtime.consumedVersion = capturedVersion;
                    return;
                }

                if (status === 'query-failed') {
                    const scheduled = scheduleQueryRetry(generation);
                    runtime.consumedVersion = capturedVersion;
                    if (!scheduled && runtime.queryRetryIndex >= queryRetryDelays.length) {
                        clearTimer('queryRetryTimer');
                    }
                    return;
                }

                if (status === 'mutation-failed') {
                    const scheduled = scheduleMutationRetry(result.sourceSignature, generation);
                    runtime.consumedVersion = capturedVersion;
                    if (!scheduled) {
                        warnMutationCircuit(result.sourceSignature);
                    }
                    return;
                }

                clearReadFailureState();
                runtime.consumedVersion = capturedVersion;
                rounds += 1;
                if (runtime.notificationVersion === capturedVersion) break;
            }
        } catch (error) {
            if (isCurrent(generation)) {
                const result = { code: error?.code || 'runner_exception', message: error?.message || String(error) };
                warnOnce(result, 'runner', {
                    action: `${actionPrefix}.run-error`,
                    message: config.messages?.runError || '派生字段运行异常',
                    error,
                });
                const capturedVersion = runtime.notificationVersion;
                scheduleQueryRetry(generation);
                runtime.consumedVersion = capturedVersion;
            }
        } finally {
            if (runtime.generation === generation) {
                runtime.running = false;
                if (isCurrent(generation)
                    && !hasRetryTimer()
                    && runtime.notificationVersion > runtime.consumedVersion) {
                    scheduleDebounce(generation);
                }
            }
        }
    }

    function requestRun() {
        if (!runtime.started) return;
        runtime.notificationVersion += 1;
        if (!runtime.fillActive && !runtime.running && !hasRetryTimer()) {
            scheduleDebounce(runtime.generation);
        }
    }

    function handleFillStart() {
        if (!runtime.started) return;
        runtime.fillActive = true;
        clearTimer('debounceTimer');
        clearTimer('availabilityTimer');
        clearTimer('queryRetryTimer');
        clearTimer('mutationRetryTimer');
        runtime.queryRetryIndex = 0;
        runtime.lastFailureErrorKey = null;
    }

    function handleTableUpdate() {
        if (!runtime.started) return;
        runtime.fillActive = false;
        clearReadFailureState();
        requestRun();
    }

    function clearRuntimeState() {
        clearTimer('debounceTimer');
        clearTimer('availabilityTimer');
        clearTimer('queryRetryTimer');
        clearTimer('mutationRetryTimer');
        runtime.unsubscribeUpdate = null;
        runtime.unsubscribeFillStart = null;
        runtime.running = false;
        runtime.fillActive = false;
        runtime.queryRetryIndex = 0;
        runtime.notificationVersion = 0;
        runtime.consumedVersion = 0;
        runtime.lastInputSignature = null;
        runtime.lastInvalidWarningSignature = null;
        runtime.lastContextWarningSignature = null;
        runtime.lastFailureErrorKey = null;
        runtime.mutationSourceSignature = null;
        runtime.mutationAttempts = 0;
        runtime.mutationCircuitOpen = false;
        runtime.pendingConfirmationSourceSignature = null;
        runtime.lastCircuitWarningSignature = null;
    }

    function disposeSubscription(unsubscribe, stage, generation) {
        if (typeof unsubscribe !== 'function') return;
        try {
            unsubscribe();
        } catch (error) {
            warnLifecycle(
                `${actionPrefix}.${stage}-unsubscribe-failed`,
                '派生字段生命周期解除订阅失败',
                { stage, generation },
                error,
            );
        }
    }

    function rollbackFailedStart(generation, subscriptions, stage, error) {
        runtime.started = false;
        runtime.generation += 1;
        disposeSubscription(subscriptions?.update, 'start-rollback-update', generation);
        disposeSubscription(subscriptions?.fillStart, 'start-rollback-fill-start', generation);
        clearRuntimeState();

        warnLifecycle(
            `${actionPrefix}.start-failed`,
            '派生字段服务启动失败，已回滚全部运行状态',
            { stage, generation },
            error,
        );
        return false;
    }

    function start() {
        if (runtime.started) return true;
        runtime.started = true;
        runtime.generation += 1;
        const generation = runtime.generation;
        const subscriptions = { update: null, fillStart: null };

        try {
            subscriptions.fillStart = deps.subscribeFillStart(handleFillStart);
        } catch (error) {
            return rollbackFailedStart(generation, subscriptions, 'subscribe-fill-start', error);
        }

        if (typeof subscriptions.fillStart !== 'function') {
            return rollbackFailedStart(
                generation,
                subscriptions,
                'invalid-fill-start-disposer',
                new TypeError('派生字段填表开始订阅未返回有效 disposer'),
            );
        }

        try {
            subscriptions.update = deps.subscribeUpdate(handleTableUpdate);
        } catch (error) {
            return rollbackFailedStart(generation, subscriptions, 'subscribe-update', error);
        }

        if (typeof subscriptions.update !== 'function') {
            return rollbackFailedStart(
                generation,
                subscriptions,
                'invalid-update-disposer',
                new TypeError('派生字段表格更新订阅未返回有效 disposer'),
            );
        }

        if (!isCurrent(generation)) {
            return rollbackFailedStart(generation, subscriptions, 'stale-generation');
        }

        runtime.unsubscribeUpdate = subscriptions.update;
        runtime.unsubscribeFillStart = subscriptions.fillStart;
        try {
            requestRun();
        } catch (error) {
            return rollbackFailedStart(generation, subscriptions, 'initial-schedule', error);
        }
        return true;
    }

    function stop() {
        runtime.generation += 1;
        runtime.started = false;
        const unsubscribeUpdate = runtime.unsubscribeUpdate;
        const unsubscribeFillStart = runtime.unsubscribeFillStart;
        runtime.unsubscribeUpdate = null;
        runtime.unsubscribeFillStart = null;

        disposeSubscription(unsubscribeUpdate, 'stop-update', runtime.generation);
        disposeSubscription(unsubscribeFillStart, 'stop-fill-start', runtime.generation);
        clearRuntimeState();
    }

    function setDeps(overrides = {}) {
        stop();
        deps = { ...defaultDeps, ...overrides };
    }

    function reset() {
        stop();
        deps = { ...defaultDeps };
    }

    function getState() {
        return {
            started: runtime.started,
            generation: runtime.generation,
            running: runtime.running,
            fillActive: runtime.fillActive,
            notificationVersion: runtime.notificationVersion,
            consumedVersion: runtime.consumedVersion,
            mutationSourceSignature: runtime.mutationSourceSignature,
            mutationAttempts: runtime.mutationAttempts,
            mutationCircuitOpen: runtime.mutationCircuitOpen,
            pendingConfirmationSourceSignature: runtime.pendingConfirmationSourceSignature,
            hasDebounceTimer: runtime.debounceTimer !== null,
            hasAvailabilityTimer: runtime.availabilityTimer !== null,
            hasQueryRetryTimer: runtime.queryRetryTimer !== null,
            hasMutationRetryTimer: runtime.mutationRetryTimer !== null,
        };
    }

    return Object.freeze({ start, stop, setDeps, reset, getState, requestRun });
}
