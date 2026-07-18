const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeClock {
    constructor() {
        this.now = 0;
        this.next = 1;
        this.tasks = new Map();
        this.maxTasks = 0;
    }

    setTimeout(fn, delay) {
        const id = this.next++;
        this.tasks.set(id, { at: this.now + Number(delay || 0), fn });
        this.maxTasks = Math.max(this.maxTasks, this.tasks.size);
        return id;
    }

    clearTimeout(id) {
        this.tasks.delete(id);
    }

    async tick(ms) {
        const target = this.now + ms;
        for (;;) {
            const due = [...this.tasks]
                .filter(([, task]) => task.at <= target)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!due) break;
            this.now = due[1].at;
            this.tasks.delete(due[0]);
            due[1].fn();
            await flush();
        }
        this.now = target;
        await flush();
    }

    delays() {
        return [...this.tasks.values()]
            .map((task) => task.at - this.now)
            .sort((a, b) => a - b);
    }
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flush() {
    for (let index = 0; index < 60; index += 1) {
        await Promise.resolve();
    }
}

function okSignature({ source = 'source-a', input = 'input-a', pending = 0 } = {}) {
    return {
        ok: true,
        rows: [{
            source_signature: source,
            input_signature: input,
            invalid_count: 0,
            invalid_row_ids: '',
            pending_update_count: pending,
        }],
    };
}

function okGate() {
    return {
        ok: true,
        rows: [{
            schema_ok: 1,
            anchor_table: 'global_state',
            missing_requirements: '',
            schema_fingerprint: 'ok',
        }],
    };
}

function isContextSql(kind, sql) {
    return kind === 'chronicle' ? sql.includes('schema_ok') : sql.includes('is_available');
}

function contextResult(kind) {
    return kind === 'chronicle'
        ? okGate()
        : { ok: true, rows: [{ is_available: 1 }] };
}

function createHarness(mod, kind, options = {}) {
    const clock = new FakeClock();
    const subscribers = new Set();
    const warnings = [];
    const state = {
        probeCalls: 0,
        queryCalls: 0,
        signatureCalls: 0,
        mutationCalls: 0,
        concurrent: 0,
        maxConcurrent: 0,
    };
    let probe = async () => ({ ok: true });
    let query = async (sql) => (isContextSql(kind, sql) ? contextResult(kind) : okSignature());
    let mutation = async () => ({ ok: true });

    const wrap = (name, getter) => async (...args) => {
        state[`${name}Calls`] += 1;
        if (name === 'query' && !isContextSql(kind, args[0])) {
            state.signatureCalls += 1;
        }
        state.concurrent += 1;
        state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
        try {
            return await getter()(...args);
        } finally {
            state.concurrent -= 1;
        }
    };

    mod.__test__setDeps({
        setTimeout: clock.setTimeout.bind(clock),
        clearTimeout: clock.clearTimeout.bind(clock),
        subscribe: options.subscribe || ((fn) => {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        }),
        probe: wrap('probe', () => probe),
        query: wrap('query', () => query),
        mutation: wrap('mutation', () => mutation),
        logger: { warn: (entry) => warnings.push(entry) },
    });

    return {
        clock,
        state,
        warnings,
        notify(count = 1) {
            for (let index = 0; index < count; index += 1) {
                subscribers.forEach((fn) => fn());
            }
        },
        subscriberCount: () => subscribers.size,
        setProbe: (fn) => { probe = fn; },
        setQuery: (fn) => { query = fn; },
        setMutation: (fn) => { mutation = fn; },
        start: kind === 'small'
            ? mod.startSmallCalendarDerivedFieldsInjection
            : mod.startChronicleTodayRelationInjection,
        stop: kind === 'small'
            ? mod.stopSmallCalendarDerivedFieldsInjection
            : mod.stopChronicleTodayRelationInjection,
        getState: mod.__test__getState,
        reset: mod.__test__reset,
    };
}

async function testProbeRetriesAreFinite(mod, kind) {
    const h = createHarness(mod, kind);
    h.setProbe(async () => ({ ok: false, code: 'not-ready', message: 'booting' }));
    h.start();
    assert.deepStrictEqual(h.clock.delays(), [600]);
    await h.clock.tick(600);
    assert.deepStrictEqual(h.clock.delays(), [1000]);
    await h.clock.tick(1000);
    assert.deepStrictEqual(h.clock.delays(), [2000]);
    await h.clock.tick(2000);
    assert.deepStrictEqual(h.clock.delays(), [5000]);
    await h.clock.tick(5000);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: probe 预算耗尽后必须停止`);
    assert.strictEqual(h.state.probeCalls, 4);

    h.notify(1000);
    assert.deepStrictEqual(h.clock.delays(), [600], `${kind}: 通知风暴只能合并成一个脏标记`);
    await h.clock.tick(600);
    assert.strictEqual(h.state.probeCalls, 5, `${kind}: 新通知只允许一次新的能力观察`);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: 普通通知不得重新灌满 probe 重试预算`);
    h.stop();
    h.reset();
}

async function testQueryRetriesAreFinite(mod, kind) {
    const h = createHarness(mod, kind);
    h.setQuery(async (sql) => {
        if (isContextSql(kind, sql)) {
            return { ok: false, code: 'timeout', message: 'timeout' };
        }
        return okSignature();
    });
    h.start();
    await h.clock.tick(600);
    assert.deepStrictEqual(h.clock.delays(), [1000]);
    await h.clock.tick(1000);
    assert.deepStrictEqual(h.clock.delays(), [2000]);
    await h.clock.tick(2000);
    assert.deepStrictEqual(h.clock.delays(), [5000]);
    await h.clock.tick(5000);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: query 失败必须有限停止`);
    assert.strictEqual(h.state.queryCalls, 4);
    assert.strictEqual(h.warnings.filter((entry) => entry.action?.includes('context-query-failed')).length, 1, `${kind}: 同类 query 错误只记录一次`);
    h.stop();
    h.reset();
}

async function testInFlightProbeNotificationKeepsRetryBackoff(mod, kind) {
    const h = createHarness(mod, kind);
    const blocked = deferred();
    h.setProbe(async () => blocked.promise);

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.probeCalls, 1, `${kind}: 初始 debounce 后必须进入 probe`);

    h.notify(1000);
    blocked.resolve({ ok: false, code: 'not-ready', message: 'booting' });
    await flush();

    assert.deepStrictEqual(
        h.clock.delays(),
        [1000],
        `${kind}: in-flight probe 期间的新通知不得把失败退避抢占成 600ms debounce`,
    );
    h.stop();
    h.reset();
}

async function testInFlightQueryNotificationKeepsRetryBackoff(mod, kind) {
    const h = createHarness(mod, kind);
    const blocked = deferred();
    h.setQuery(async (sql) => (isContextSql(kind, sql) ? blocked.promise : okSignature()));

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.queryCalls, 1, `${kind}: 初始 debounce 后必须进入 context query`);

    h.notify(1000);
    blocked.resolve({ ok: false, code: 'query_timeout', message: 'query unavailable' });
    await flush();

    assert.deepStrictEqual(
        h.clock.delays(),
        [1000],
        `${kind}: in-flight query 期间的新通知不得把失败退避抢占成 600ms debounce`,
    );
    h.stop();
    h.reset();
}

async function testPendingZeroNeverMutates(mod, kind) {
    const h = createHarness(mod, kind);
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({ source: 'stable', input: 'stable', pending: 0 })));
    h.start();
    await h.clock.tick(600);
    h.notify(1000);
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 0, `${kind}: pending_update_count=0 时禁止调用 mutation`);
    h.stop();
    h.reset();
}

async function testConfirmedMutationFailureRetriesExactlyOnce(mod, kind) {
    const h = createHarness(mod, kind);
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({ source: 'source-fail', input: 'dirty', pending: 1 })));
    h.setMutation(async () => ({ ok: false, code: 'mutation_failed', message: 'confirmed failure' }));
    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1);
    assert.deepStrictEqual(h.clock.delays(), [2000], `${kind}: 明确失败后只能安排一次补试`);

    h.notify(1000);
    assert.deepStrictEqual(h.clock.delays(), [2000], `${kind}: 普通通知不得清空同源 mutation 预算`);
    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 同一 source signature 总写入次数必须为 2`);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: 第二次明确失败后必须熔断`);
    assert.strictEqual(h.getState().mutationCircuitOpen, true);

    h.notify(1000);
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 熔断后通知风暴不得增加真实写调用`);
    assert.ok(h.warnings.some((entry) => entry.action?.includes('mutation-circuit-open')), `${kind}: 熔断必须留下单次诊断`);
    h.stop();
    h.reset();
}

async function testConfirmedSuccessCannotRearmSameSourceBudget(mod, kind) {
    const h = createHarness(mod, kind);
    let dirty = true;
    let revision = 1;
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({
            source: 'stable-source',
            input: `revision-${revision}-${dirty ? 'dirty' : 'clean'}`,
            pending: dirty ? 1 : 0,
        })));
    h.setMutation(async () => {
        dirty = false;
        return { ok: true };
    });

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 首次同源漂移必须执行真实写入`);
    assert.strictEqual(h.getState().mutationAttempts, 1, `${kind}: 成功确认不得清空已消费预算`);

    revision += 1;
    dirty = true;
    h.notify();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 同源成功后只允许唯一一次后续真实写入`);
    assert.strictEqual(h.getState().mutationAttempts, 2, `${kind}: 第二次成功确认后预算必须保持耗尽`);

    revision += 1;
    dirty = true;
    h.notify(1000);
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 同源第三次漂移不得因历史成功重新获得预算`);
    assert.strictEqual(h.getState().mutationCircuitOpen, true, `${kind}: 同源两次真实写入后必须打开熔断`);
    h.stop();
    h.reset();
}

async function testSourceChangeRearmsMutationBudget(mod, kind) {
    const h = createHarness(mod, kind);
    let source = 'source-a';
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({ source, input: `${source}-dirty`, pending: 1 })));
    h.setMutation(async () => ({ ok: false, code: 'mutation_failed', message: 'confirmed failure' }));
    h.start();
    await h.clock.tick(600);
    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2);
    assert.strictEqual(h.getState().mutationCircuitOpen, true);

    source = 'source-b';
    h.notify();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 3, `${kind}: source signature 变化必须重新武装预算`);
    assert.strictEqual(h.getState().mutationSourceSignature, 'source-b');
    h.stop();
    h.reset();
}

async function testLifecycleFailuresRollbackCompletely(mod, kind) {
    const thrown = createHarness(mod, kind, {
        subscribe() {
            throw new Error('subscribe exploded');
        },
    });
    assert.strictEqual(thrown.start(), false, `${kind}: subscribe 抛错必须返回 false`);
    assert.strictEqual(thrown.getState().started, false, `${kind}: subscribe 抛错不得残留 started`);
    assert.strictEqual(thrown.getState().notificationVersion, 0, `${kind}: subscribe 抛错不得残留脏版本`);
    assert.strictEqual(thrown.clock.tasks.size, 0, `${kind}: subscribe 抛错不得残留 timer`);
    assert.ok(thrown.warnings.some((entry) => entry.action?.includes('start-failed')), `${kind}: 启动失败必须记录结构化警告`);

    const recovered = createHarness(mod, kind);
    assert.strictEqual(recovered.start(), true, `${kind}: 启动失败并替换合法依赖后必须能够重新启动`);
    assert.strictEqual(recovered.getState().started, true);
    assert.deepStrictEqual(recovered.clock.delays(), [600]);
    recovered.stop();
    recovered.reset();

    const invalidDisposer = createHarness(mod, kind, {
        subscribe(callback) {
            callback();
            return null;
        },
    });
    assert.strictEqual(invalidDisposer.start(), false, `${kind}: 无效 disposer 必须使启动失败`);
    assert.strictEqual(invalidDisposer.getState().started, false);
    assert.strictEqual(invalidDisposer.getState().notificationVersion, 0, `${kind}: 同步回调产生的脏版本必须回滚`);
    assert.strictEqual(invalidDisposer.clock.tasks.size, 0, `${kind}: 同步回调创建的 timer 必须回滚`);
    invalidDisposer.reset();

    let disposerCalls = 0;
    const throwingDisposer = createHarness(mod, kind, {
        subscribe() {
            return () => {
                disposerCalls += 1;
                throw new Error('dispose exploded');
            };
        },
    });
    assert.strictEqual(throwingDisposer.start(), true);
    assert.doesNotThrow(() => throwingDisposer.stop(), `${kind}: disposer 抛错不得中断 stop`);
    assert.strictEqual(disposerCalls, 1);
    assert.strictEqual(throwingDisposer.getState().started, false);
    assert.strictEqual(throwingDisposer.getState().running, false);
    assert.strictEqual(throwingDisposer.getState().notificationVersion, 0);
    assert.strictEqual(throwingDisposer.getState().mutationSourceSignature, null);
    assert.strictEqual(throwingDisposer.clock.tasks.size, 0, `${kind}: disposer 抛错后仍必须清理全部 timer`);
    assert.ok(throwingDisposer.warnings.some((entry) => entry.action?.includes('stop-unsubscribe-failed')), `${kind}: disposer 抛错必须记录结构化警告`);
    throwingDisposer.reset();
}

async function testPendingMutationCoalescesNotifications(mod, kind) {
    const h = createHarness(mod, kind);
    const blocked = deferred();
    let settled = false;
    let signatureReads = 0;
    h.setQuery(async (sql) => {
        if (isContextSql(kind, sql)) return contextResult(kind);
        signatureReads += 1;
        return okSignature({
            source: 'slow-source',
            input: settled ? 'clean' : 'dirty',
            pending: settled ? 0 : 1,
        });
    });
    h.setMutation(async () => blocked.promise);
    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1);
    h.notify(1000);
    await h.clock.tick(60_000);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: mutation settlement 前任何通知都不得二次写入`);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: pending mutation 期间不得创建 retry timer`);

    settled = true;
    blocked.resolve({ ok: true });
    await flush();
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 晚到成功后只做签名确认，不重复写`);
    assert.ok(signatureReads >= 2, `${kind}: mutation settle 后必须查询写后签名`);
    assert.strictEqual(h.state.maxConcurrent, 1, `${kind}: 派生服务内部最大并发必须为 1`);
    h.stop();
    h.reset();
}

async function testConfirmationQueryRetriesWithoutDuplicateMutation(mod, kind) {
    const h = createHarness(mod, kind);
    let signatureCalls = 0;
    h.setQuery(async (sql) => {
        if (isContextSql(kind, sql)) return contextResult(kind);
        signatureCalls += 1;
        if (signatureCalls === 1) {
            return okSignature({ source: 'confirm-source', input: 'dirty', pending: 1 });
        }
        if (signatureCalls === 2 || signatureCalls === 3) {
            return { ok: false, code: 'query_timeout', message: 'confirmation query unavailable' };
        }
        return okSignature({ source: 'confirm-source', input: 'clean', pending: 0 });
    });
    h.setMutation(async () => ({ ok: true }));

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 首次真实写入必须执行一次`);
    assert.strictEqual(
        h.getState().pendingConfirmationSourceSignature,
        'confirm-source',
        `${kind}: 写后查询失败时必须保留待确认 source`,
    );
    assert.deepStrictEqual(h.clock.delays(), [1000]);

    await h.clock.tick(1000);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 确认查询重试不得再次写入`);
    assert.deepStrictEqual(h.clock.delays(), [2000]);

    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 查询恢复后只能确认首次写入`);
    assert.strictEqual(h.getState().pendingConfirmationSourceSignature, null);
    assert.strictEqual(h.clock.tasks.size, 0);

    h.notify(1000);
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: clean 确认后的通知风暴不得补写`);
    h.stop();
    h.reset();
}

async function testUnconfirmedSuccessCannotExceedMutationBudget(mod, kind) {
    const h = createHarness(mod, kind);
    let signatureCalls = 0;
    h.setQuery(async (sql) => {
        if (isContextSql(kind, sql)) return contextResult(kind);
        signatureCalls += 1;
        if (signatureCalls === 2 || signatureCalls === 5) {
            return { ok: false, code: 'query_timeout', message: 'confirmation query unavailable' };
        }
        return okSignature({ source: 'unconfirmed-source', input: 'dirty', pending: 1 });
    });
    h.setMutation(async () => ({ ok: true }));

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1);
    assert.deepStrictEqual(h.clock.delays(), [1000]);

    await h.clock.tick(1000);
    assert.strictEqual(h.state.mutationCalls, 1, `${kind}: 首次确认仍 pending 时只能安排补试，不能立即写`);
    assert.deepStrictEqual(h.clock.delays(), [2000]);

    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 同源只允许唯一一次补写`);
    assert.deepStrictEqual(h.clock.delays(), [2000]);

    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 第二次写入无法确认后必须熔断`);
    assert.strictEqual(h.getState().mutationCircuitOpen, true);
    assert.strictEqual(h.clock.tasks.size, 0);

    h.notify(1000);
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 熔断后普通通知不得越过写入上限`);
    h.stop();
    h.reset();
}

async function testThrownMutationUsesFiniteRetryBudget(mod, kind) {
    const h = createHarness(mod, kind);
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({ source: 'throw-source', input: 'dirty', pending: 1 })));
    h.setMutation(async () => {
        throw new Error('mutation exploded');
    });

    h.start();
    await h.clock.tick(600);
    assert.strictEqual(h.state.mutationCalls, 1);
    assert.deepStrictEqual(h.clock.delays(), [2000]);
    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: mutation throw 也只能补试一次`);
    assert.strictEqual(h.getState().mutationCircuitOpen, true);
    assert.strictEqual(h.clock.tasks.size, 0);
    h.stop();
    h.reset();
}

async function testLateFailureAllowsOneRetry(mod, kind) {
    const h = createHarness(mod, kind);
    const blocked = deferred();
    h.setQuery(async (sql) => (isContextSql(kind, sql)
        ? contextResult(kind)
        : okSignature({ source: 'late-fail', input: 'dirty', pending: 1 })));
    let first = true;
    h.setMutation(async () => {
        if (first) {
            first = false;
            return blocked.promise;
        }
        return { ok: false, code: 'mutation_failed', message: 'second failure' };
    });
    h.start();
    await h.clock.tick(600);
    h.notify(1000);
    assert.strictEqual(h.state.mutationCalls, 1);
    blocked.resolve({ ok: false, code: 'mutation_rejected', message: 'late rejection' });
    await flush();
    assert.deepStrictEqual(h.clock.delays(), [2000]);
    await h.clock.tick(2000);
    assert.strictEqual(h.state.mutationCalls, 2, `${kind}: 晚到明确失败后只允许一次补试`);
    assert.strictEqual(h.clock.tasks.size, 0);
    h.stop();
    h.reset();
}

async function testGenerationIsolation(mod, kind) {
    const h = createHarness(mod, kind);
    const blocked = deferred();
    h.setProbe(async () => blocked.promise);
    h.start();
    await h.clock.tick(600);
    h.stop();
    h.start();
    blocked.resolve({ ok: true });
    await flush();
    assert.strictEqual(h.state.queryCalls, 0, `${kind}: stop/restart 后旧 generation 不得继续查询`);
    assert.deepStrictEqual(h.clock.delays(), [600]);
    assert.strictEqual(h.subscriberCount(), 1, `${kind}: restart 后只能保留一个订阅`);
    h.stop();
    assert.strictEqual(h.subscriberCount(), 0);
    h.reset();
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const small = await import(`${pathToFileURL(path.join(root, 'modules/phone-core/derived-fields/small-calendar-derived-fields.js')).href}?behavior=${Date.now()}`);
    const chronicle = await import(`${pathToFileURL(path.join(root, 'modules/phone-core/derived-fields/chronicle-today-relation.js')).href}?behavior=${Date.now()}`);

    for (const [mod, kind] of [[small, 'small'], [chronicle, 'chronicle']]) {
        await testProbeRetriesAreFinite(mod, kind);
        await testQueryRetriesAreFinite(mod, kind);
        await testInFlightProbeNotificationKeepsRetryBackoff(mod, kind);
        await testInFlightQueryNotificationKeepsRetryBackoff(mod, kind);
        await testPendingZeroNeverMutates(mod, kind);
        await testConfirmedMutationFailureRetriesExactlyOnce(mod, kind);
        await testConfirmedSuccessCannotRearmSameSourceBudget(mod, kind);
        await testSourceChangeRearmsMutationBudget(mod, kind);
        await testLifecycleFailuresRollbackCompletely(mod, kind);
        await testPendingMutationCoalescesNotifications(mod, kind);
        await testConfirmationQueryRetriesWithoutDuplicateMutation(mod, kind);
        await testUnconfirmedSuccessCannotExceedMutationBudget(mod, kind);
        await testThrownMutationUsesFiniteRetryBudget(mod, kind);
        await testLateFailureAllowsOneRetry(mod, kind);
        await testGenerationIsolation(mod, kind);
    }

    const a = createHarness(small, 'small');
    const b = createHarness(chronicle, 'chronicle');
    a.start();
    b.start();
    a.notify();
    assert.strictEqual(a.clock.tasks.size, 1);
    assert.strictEqual(b.clock.tasks.size, 1, '两个派生服务的 timer/state 必须隔离');
    a.stop();
    b.stop();
    a.reset();
    b.reset();

    console.log('[通过] 派生调度行为：读失败退避不被 in-flight 通知抢占、pending=0 零写入、成功确认不重置同源预算、启动失败完整回滚、确认查询仅重试查询、同源最多两次写入、通知不重置预算、慢写合并通知、源变化重武装、generation 隔离');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
