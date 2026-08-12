const assert = require('node:assert/strict');

const row = (key, top, bottom) => ({
    dataset: { key },
    getBoundingClientRect: () => ({ top, bottom }),
});

const root = (rows, {
    top = 100,
    bottom = 300,
    scrollTop = 0,
    scrollHeight = 600,
    clientHeight = 200,
} = {}) => ({
    children: rows,
    scrollTop,
    scrollHeight,
    clientHeight,
    getBoundingClientRect: () => ({ top, bottom }),
});

async function main() {
    const {
        DEFAULT_SCROLL_BOTTOM_THRESHOLD,
        captureStableScrollAnchor,
        isScrollContainerNearBottom,
        restoreStableScrollAnchor,
        scheduleStableScrollAnchorRestore,
    } = await import('../modules/phone-core/stable-scroll-anchor.js');
    const getKey = item => item.dataset.key;

    assert.equal(DEFAULT_SCROLL_BOTTOM_THRESHOLD, 32);
    assert.equal(isScrollContainerNearBottom(root([], {
        scrollTop: 368, scrollHeight: 600, clientHeight: 200,
    })), true, 'the shared threshold includes an exact 32px bottom gap');

    const bottomAnchor = captureStableScrollAnchor(root([], {
        scrollTop: 370, scrollHeight: 600, clientHeight: 200,
    }), { getKey });
    assert.deepEqual(bottomAnchor, { mode: 'bottom' });
    const tallerRoot = root([], { scrollHeight: 900, clientHeight: 200 });
    assert.equal(restoreStableScrollAnchor(tallerRoot, bottomAnchor, { getKey }), true);
    assert.equal(tallerRoot.scrollTop, 700, 'bottom mode follows the new content height');

    const previousRoot = root([
        row('alice', 60, 100),
        row('bravo', 112, 152),
        row('charlie', 164, 204),
    ], { scrollTop: 140, scrollHeight: 360, clientHeight: 200 });
    const anchor = captureStableScrollAnchor(previousRoot, { getKey, stickToBottom: false });
    assert.deepEqual(anchor, { mode: 'anchor', key: 'bravo', viewportOffset: 12 });

    const refreshedRoot = root([
        row('new-top', 112, 152),
        row('alice', 124, 164),
        row('bravo', 164, 204),
        row('charlie', 216, 256),
    ], { scrollTop: 140 });
    assert.equal(restoreStableScrollAnchor(refreshedRoot, anchor, { getKey }), true);
    assert.equal(refreshedRoot.scrollTop, 192, 'the first visible stable row keeps its viewport offset');

    const missingRoot = root([row('alice', 112, 152)], { scrollTop: 73 });
    assert.equal(restoreStableScrollAnchor(missingRoot, anchor, { getKey }), false);
    assert.equal(missingRoot.scrollTop, 73, 'a missing stable key must not move the viewport');

    const staleRoot = root([row('bravo', 164, 204)], { scrollTop: 140 });
    let queuedRestore;
    scheduleStableScrollAnchorRestore({
        anchor,
        token: 4,
        isCurrent: () => false,
        getRoot: () => staleRoot,
        getKey,
        enqueue: callback => { queuedRestore = callback; },
    });
    queuedRestore();
    assert.equal(staleRoot.scrollTop, 140, 'a stale render must not mutate scroll');

    const mountedRoot = root([row('bravo', 164, 204)], { scrollTop: 140 });
    let queuedMountedRestore;
    scheduleStableScrollAnchorRestore({
        anchor,
        token: 5,
        isCurrent: token => token === 5,
        getRoot: () => mountedRoot,
        getKey,
        enqueue: callback => { queuedMountedRestore = callback; },
    });
    assert.equal(mountedRoot.scrollTop, 140, 'scheduled restoration waits until after mount');
    queuedMountedRestore();
    assert.equal(mountedRoot.scrollTop, 192, 'the current mounted render restores its stable anchor');

    const cancelledRoot = root([row('bravo', 164, 204)], { scrollTop: 140 });
    let queuedCancelledRestore;
    const cancel = scheduleStableScrollAnchorRestore({
        anchor,
        getRoot: () => cancelledRoot,
        getKey,
        enqueue: callback => { queuedCancelledRestore = callback; },
    });
    cancel();
    queuedCancelledRestore();
    assert.equal(cancelledRoot.scrollTop, 140, 'cancelled restoration must not mutate scroll');
}

main().then(() => console.log('[phone-stable-scroll-anchor] passed')).catch((error) => {
    console.error('[phone-stable-scroll-anchor] failed');
    console.error(error);
    process.exitCode = 1;
});
