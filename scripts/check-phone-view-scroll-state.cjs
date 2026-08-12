const assert = require('node:assert/strict');

const row = (key, top, bottom) => ({
    dataset: { key },
    getBoundingClientRect: () => ({ top, bottom }),
});

const root = (rows = [], options = {}) => ({
    children: rows,
    scrollTop: options.scrollTop || 0,
    scrollHeight: options.scrollHeight || 600,
    clientHeight: options.clientHeight || 200,
    querySelectorAll: () => rows,
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
});

async function main() {
    const { createPhoneViewScrollState } = await import('../modules/phone-core/view-scroll-state.js');
    let scopeKey = 'scope-a';
    let viewKey = 'page:settings:context';
    let activeRoot = root([], { scrollTop: 84 });
    let queued = null;
    const state = createPhoneViewScrollState({
        getScopeKey: () => scopeKey,
        getViewKey: () => viewKey,
        enqueue: (callback) => { queued = callback; },
    });
    state.register({
        key: 'secondary',
        matches: (key) => key.startsWith('page:settings:'),
        getRoot: () => activeRoot,
    });
    state.register({
        key: 'chat',
        matches: (key) => key.startsWith('page:chat:'),
        getRoot: () => activeRoot,
        mode: 'anchor',
        getItems: (element) => element.querySelectorAll(),
        getKey: (item) => item.dataset.key,
    });

    const settingsSnapshot = state.capture();
    activeRoot = root([], { scrollTop: 0, scrollHeight: 700, clientHeight: 200 });
    state.restore(settingsSnapshot, { token: 4, isCurrent: (token) => token === 4 });
    queued();
    assert.equal(activeRoot.scrollTop, 84, 'secondary settings restore their own scroll offset');

    activeRoot.scrollTop = 0;
    state.restore(settingsSnapshot, { token: 5, isCurrent: () => true });
    scopeKey = 'scope-b';
    queued();
    assert.equal(activeRoot.scrollTop, 0, 'a scope change cannot reuse another chat scroll snapshot');

    scopeKey = 'scope-a';
    viewKey = 'page:chat:alice';
    activeRoot = root([row('m1', 112, 152)], { scrollTop: 368, scrollHeight: 600, clientHeight: 200 });
    const bottomSnapshot = state.capture();
    activeRoot = root([row('m1', 112, 152)], { scrollTop: 0, scrollHeight: 900, clientHeight: 200 });
    state.restore(bottomSnapshot, { token: 6, isCurrent: (token) => token === 6 });
    queued();
    assert.equal(activeRoot.scrollTop, 700, 'chat bottom mode follows the refreshed content height');

    activeRoot.scrollTop = 20;
    state.restore(bottomSnapshot, { token: 7, isCurrent: () => true });
    viewKey = 'page:chat:bravo';
    queued();
    assert.equal(activeRoot.scrollTop, 20, 'a view change cannot reuse another conversation anchor');

    state.dispose();
    console.log('[phone-view-scroll-state] passed');
}

main().catch((error) => {
    console.error('[phone-view-scroll-state] failed');
    console.error(error);
    process.exitCode = 1;
});
