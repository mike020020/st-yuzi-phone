const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function settle(times = 6) {
    let pending = Promise.resolve();
    for (let index = 0; index < times; index += 1) {
        pending = pending.then(() => new Promise(resolve => setImmediate(resolve)));
    }
    return pending;
}

function deferred() {
    let resolve;
    const promise = new Promise((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

function createFacadeFixture() {
    let scopeId = 'scope-alpha';
    const unreadByScope = new Map([
        ['scope-alpha', 4],
        ['scope-beta', 3],
    ]);
    const subscriptions = new Set();
    let nextUnreadGate = null;
    let unreadStarted = null;

    const facade = {
        query: {
            async bootstrap() {
                return { ok: true, context: { scopeId } };
            },
            async unread() {
                const readScopeId = scopeId;
                unreadStarted?.resolve(readScopeId);
                unreadStarted = null;
                const gate = nextUnreadGate;
                nextUnreadGate = null;
                if (gate) await gate.promise;
                return {
                    ok: true,
                    unread: { total: unreadByScope.get(readScopeId) || 0 },
                };
            },
        },
        async subscribe(listener) {
            const subscription = { scopeId, listener };
            subscriptions.add(subscription);
            return () => subscriptions.delete(subscription);
        },
    };

    return {
        facade,
        setScope(nextScopeId) {
            scopeId = nextScopeId;
        },
        setUnread(targetScopeId, total) {
            unreadByScope.set(targetScopeId, total);
        },
        holdNextUnread() {
            nextUnreadGate = deferred();
            unreadStarted = deferred();
            return {
                release: nextUnreadGate.resolve,
                started: unreadStarted.promise,
            };
        },
        async emit(targetScopeId = scopeId) {
            const listeners = [...subscriptions]
                .filter(subscription => subscription.scopeId === targetScopeId)
                .map(subscription => subscription.listener({ status: 'changed', scopeId: targetScopeId }));
            await Promise.all(listeners);
        },
    };
}

(async () => {
    const { buildHomeScreenViewModel } = await import('../modules/phone-home/view-model.js');
    const { createQQHomeUnreadProjection } = await import('../modules/phone-home/qq-unread.js');
    const fixture = createFacadeFixture();
    const received = [];
    const projection = createQQHomeUnreadProjection({
        facade: fixture.facade,
        onChange: (total) => received.push(total),
    });

    assert.equal(await projection.start(), true, 'the home projection reads the Facade on startup');
    assert.equal(projection.getTotal(), 4);
    let viewModel = buildHomeScreenViewModel(null, {}, { qqUnreadTotal: projection.getTotal() });
    let qq = viewModel.apps.find(app => app.key === '__qq__');
    assert.deepEqual({ totalCount: qq.totalCount, badgeText: qq.badgeText }, { totalCount: 4, badgeText: '4' },
        'the home QQ icon receives the same total through the home view model');
    const hiddenViewModel = buildHomeScreenViewModel(null, {
        hiddenTableApps: { __qq__: true },
    }, { qqUnreadTotal: projection.getTotal() });
    assert.equal(hiddenViewModel.apps.some(app => app.key === '__qq__'), false,
        'the shared hidden App setting removes QQ from the homepage');

    fixture.setUnread('scope-alpha', 102);
    await fixture.emit('scope-alpha');
    await settle();
    assert.equal(projection.getTotal(), 102, 'subscription changes refresh the same Facade unread total');
    viewModel = buildHomeScreenViewModel(null, {}, { qqUnreadTotal: projection.getTotal() });
    qq = viewModel.apps.find(app => app.key === '__qq__');
    assert.deepEqual({ totalCount: qq.totalCount, badgeText: qq.badgeText }, { totalCount: 102, badgeText: '99+' },
        'the home QQ icon uses the shared 99+ presentation rule');

    fixture.setUnread('scope-alpha', 2);
    await fixture.emit('scope-alpha');
    await settle();
    assert.equal(projection.getTotal(), 2, 'a conversation deletion decrement is reflected in the homepage total');

    fixture.setUnread('scope-alpha', 7);
    const staleRead = fixture.holdNextUnread();
    const refresh = projection.refresh();
    assert.equal(await staleRead.started, 'scope-alpha');
    fixture.setScope('scope-beta');
    staleRead.release();
    await refresh;
    await settle();
    assert.equal(received.includes(7), false, 'an old-scope async read never writes a stale badge');
    assert.equal(projection.getTotal(), 3, 'a scope transition refreshes the current scope instead');

    fixture.setUnread('scope-beta', 1);
    await fixture.emit('scope-beta');
    await settle();
    assert.equal(projection.getTotal(), 1, 'the subscription is rebound for the current scope');

    const renderSource = await fs.readFile(path.join(__dirname, '..', 'modules', 'phone-home', 'render.js'), 'utf8');
    assert.match(renderSource, /getQQV2Facade/, 'home rendering resolves the runtime Facade instead of data storage');
    assert.match(renderSource, /ensureQQHomeUnreadProjection/, 'home rendering owns a scoped unread projection');
    assert.match(renderSource, /qqUnreadTotal/, 'projection changes repatch the QQ app icon through the view model');

    projection.destroy();
    fixture.setUnread('scope-beta', 9);
    await fixture.emit('scope-beta');
    await settle();
    assert.equal(projection.getTotal(), 1, 'destroy removes the homepage subscription');
    console.log('[qq-home-unread-contract] passed');
})().catch((error) => {
    console.error('[qq-home-unread-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
