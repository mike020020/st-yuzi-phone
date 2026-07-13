const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeClock {
    constructor() { this.now = 0; this.next = 1; this.tasks = new Map(); }
    setTimeout(fn, delay) { const id = this.next++; this.tasks.set(id, { at: this.now + delay, fn }); this.maxTasks = Math.max(this.maxTasks || 0, this.tasks.size); return id; }
    clearTimeout(id) { this.tasks.delete(id); }
    async tick(ms) { const target = this.now + ms; while (true) { const due = [...this.tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!due) break; this.now = due[1].at; this.tasks.delete(due[0]); due[1].fn(); await flush(); } this.now = target; await flush(); }
    delays() { return [...this.tasks.values()].map((task) => task.at - this.now).sort((a, b) => a - b); }
}
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 40; i += 1) await Promise.resolve(); }
function okSignature(value = 'sig') { return { ok: true, rows: [{ source_signature: value, input_signature: value, invalid_count: 0, invalid_row_ids: '' }] }; }
function okGate() { return { ok: true, rows: [{ schema_ok: 1, anchor_table: 'global_state', missing_requirements: '', schema_fingerprint: 'ok' }] }; }
function createHarness(mod, kind) {
    const clock = new FakeClock(); const subscribers = new Set(); const warnings = []; const state = { probeCalls: 0, queryCalls: 0, mutationCalls: 0, concurrent: 0, maxConcurrent: 0 };
    let probe = async () => ({ ok: true }); let query = async (sql) => kind === 'chronicle' && sql.includes('schema_ok') ? okGate() : kind === 'small' && sql.includes('is_available') ? { ok: true, rows: [{ is_available: 1 }] } : okSignature(); let mutation = async () => ({ ok: true });
    const wrap = (name, getter) => async (...args) => { state[`${name}Calls`] += 1; state.concurrent += 1; state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent); try { return await getter()(...args); } finally { state.concurrent -= 1; } };
    mod.__test__setDeps({ setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock), subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }, probe: wrap('probe', () => probe), query: wrap('query', () => query), mutation: wrap('mutation', () => mutation), logger: { warn: (entry) => warnings.push(entry) } });
    return { clock, state, warnings, notify: () => subscribers.forEach((fn) => fn()), setProbe: (fn) => { probe = fn; }, setQuery: (fn) => { query = fn; }, setMutation: (fn) => { mutation = fn; }, start: kind === 'small' ? mod.startSmallCalendarDerivedFieldsInjection : mod.startChronicleTodayRelationInjection, stop: kind === 'small' ? mod.stopSmallCalendarDerivedFieldsInjection : mod.stopChronicleTodayRelationInjection, reset: mod.__test__reset };
}
async function testProbe(mod, kind) {
    const h = createHarness(mod, kind); h.setProbe(async () => ({ ok: false, code: 'not-ready', message: 'booting' })); h.start();
    assert.deepStrictEqual(h.clock.delays(), [600]); await h.clock.tick(600); assert.deepStrictEqual(h.clock.delays(), [1000], `${kind}: probe retry 必须独占 timer`);
    await h.clock.tick(1000); assert.deepStrictEqual(h.clock.delays(), [2000]); await h.clock.tick(2000); assert.deepStrictEqual(h.clock.delays(), [5000]); await h.clock.tick(5000);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}: 1/2/5 秒耗尽后必须停止`); assert.strictEqual(h.state.probeCalls, 4);
    h.notify(); assert.deepStrictEqual(h.clock.delays(), [600]); await h.clock.tick(600); assert.deepStrictEqual(h.clock.delays(), [1000], `${kind}: 新通知必须重开 probe 序列`); h.stop(); assert.strictEqual(h.clock.tasks.size, 0); h.reset();
}
async function testFailures(mod, kind) {
    const h = createHarness(mod, kind); let queryFailures = 4;
    h.setQuery(async (sql) => { if (kind === 'chronicle' && sql.includes('schema_ok')) { if (queryFailures-- > 0) return { ok: false, code: 'timeout', message: 'timeout' }; return okGate(); } if (kind === 'small' && sql.includes('is_available')) { if (queryFailures-- > 0) return { ok: false, code: 'timeout', message: 'timeout' }; return { ok: true, rows: [{ is_available: 1 }] }; } return okSignature('q'); });
    h.start(); await h.clock.tick(600); assert.deepStrictEqual(h.clock.delays(), [1000]); await h.clock.tick(1000); assert.deepStrictEqual(h.clock.delays(), [2000]); await h.clock.tick(2000); assert.deepStrictEqual(h.clock.delays(), [5000]); await h.clock.tick(5000); assert.strictEqual(h.clock.tasks.size, 0, `${kind}: query failure 必须有限停止`);
    assert.ok(h.warnings.some((entry) => String(entry.message).includes('结果未确认，底层可能仍在执行')), `${kind}: timeout 必须保守告警`); h.stop(); h.reset();

    const m = createHarness(mod, kind); m.setMutation(async () => ({ ok: false, code: 'timeout', message: 'timeout' })); m.start(); await m.clock.tick(600); assert.deepStrictEqual(m.clock.delays(), [2000], `${kind}: mutation 未确认不得立即重写`); await m.clock.tick(2000); assert.deepStrictEqual(m.clock.delays(), [5000]); await m.clock.tick(5000); assert.strictEqual(m.clock.tasks.size, 0); assert.strictEqual(m.state.mutationCalls, 3); m.stop(); m.reset();
}
async function testNotificationSupersedesOldFailure(mod, kind, failureKind) {
    const h = createHarness(mod, kind); const blocked = deferred(); let fresh = false;
    if (failureKind === 'probe') {
        let first = true;
        h.setProbe(async () => { if (first) { first = false; return blocked.promise; } fresh = true; return { ok: true }; });
    } else if (failureKind === 'query') {
        let first = true;
        h.setQuery(async (sql) => {
            const target = kind === 'chronicle' ? sql.includes('schema_ok') : sql.includes('is_available');
            if (target && first) { first = false; return blocked.promise; }
            if (target) fresh = true;
            return kind === 'chronicle' && sql.includes('schema_ok') ? okGate() : kind === 'small' && sql.includes('is_available') ? { ok: true, rows: [{ is_available: 1 }] } : okSignature('fresh-query');
        });
    } else {
        let first = true;
        h.setMutation(async () => { if (first) { first = false; return blocked.promise; } fresh = true; return { ok: true }; });
    }
    h.start(); await h.clock.tick(600); h.notify();
    blocked.resolve({ ok: false, code: 'timeout', message: 'old failure' }); await flush();
    assert.deepStrictEqual(h.clock.delays(), [600], `${kind}/${failureKind}: 旧失败必须让位给最新通知的 debounce`);
    assert.strictEqual(h.clock.tasks.size, 1, `${kind}/${failureKind}: 不得并存 failure/probe timer`);
    await h.clock.tick(600);
    assert.ok(fresh, `${kind}/${failureKind}: 600ms 后必须使用新数据执行`);
    assert.strictEqual(h.state.maxConcurrent, 1, `${kind}/${failureKind}: 最大并发必须为 1`);
    assert.ok((h.clock.maxTasks || 0) <= 1, `${kind}/${failureKind}: 任意时刻只能有一个 timer`);
    assert.strictEqual(h.clock.tasks.size, 0, `${kind}/${failureKind}: 成功后不得残留 timer（通知不得被旧失败消费）`);
    h.stop(); h.reset();
}
async function testRoundsAndGeneration(mod, kind) {
    const h = createHarness(mod, kind); const firstProbe = deferred(); let useGate = true; h.setProbe(async () => useGate ? firstProbe.promise : ({ ok: true })); h.start(); await h.clock.tick(600); h.notify(); firstProbe.resolve({ ok: true }); await flush(); assert.ok(h.state.probeCalls >= 2, `${kind}: 运行通知必须触发补轮`); assert.strictEqual(h.state.maxConcurrent, 1);
    h.notify(); await flush(); assert.strictEqual(h.clock.tasks.size, 1, `${kind}: 补轮残余必须 debounce`); h.stop(); h.reset();

    const old = createHarness(mod, kind); const blocked = deferred(); old.setProbe(async () => blocked.promise); old.start(); await old.clock.tick(600); old.stop(); useGate = false; old.start(); blocked.resolve({ ok: true }); await flush(); assert.strictEqual(old.state.queryCalls, 0, `${kind}: stop/restart 后旧 Promise 不得污染新 generation`); assert.deepStrictEqual(old.clock.delays(), [600]); old.stop(); old.reset();
}
async function main() {
    const root = path.resolve(__dirname, '..');
    const small = await import(`${pathToFileURL(path.join(root, 'modules/phone-core/derived-fields/small-calendar-derived-fields.js')).href}?behavior=${Date.now()}`);
    const chronicle = await import(`${pathToFileURL(path.join(root, 'modules/phone-core/derived-fields/chronicle-today-relation.js')).href}?behavior=${Date.now()}`);
    for (const [mod, kind] of [[small, 'small'], [chronicle, 'chronicle']]) {
        await testProbe(mod, kind);
        await testFailures(mod, kind);
        for (const failureKind of ['query', 'mutation', 'probe']) await testNotificationSupersedesOldFailure(mod, kind, failureKind);
        await testRoundsAndGeneration(mod, kind);
    }
    const a = createHarness(small, 'small'); const b = createHarness(chronicle, 'chronicle'); a.start(); b.start(); a.notify(); assert.strictEqual(a.clock.tasks.size, 1); assert.strictEqual(b.clock.tasks.size, 1, '两个服务 timer/state 必须独立'); a.stop(); b.stop(); a.reset(); b.reset();
    console.log('[通过] 真实派生模块 fake clock/deferred 调度行为：probe、失败退避、运行中通知压过旧失败、两轮、单并发、generation、双服务隔离');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
