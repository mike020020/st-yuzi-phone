const assert = require('node:assert/strict');

async function main() {
    const { createRenderLeaseCoordinator } = await import('../modules/qq-v2/ui/render-lease-coordinator.js');
    let acquireCount = 0;
    const released = [];
    const coordinator = createRenderLeaseCoordinator({
        async acquire(key) {
            acquireCount += 1;
            return { leaseId: `lease-${acquireCount}`, url: `blob:${key}:${acquireCount}` };
        },
        async release(render) {
            released.push(render.leaseId);
        },
    });

    const first = coordinator.begin();
    const firstAvatar = await first.load('avatar-a');
    await first.commit();
    assert.equal(acquireCount, 1);
    assert.deepEqual(released, [], 'the mounted render retains its visible object URL');

    const second = coordinator.begin();
    assert.equal(second.peek('avatar-a'), firstAvatar, 'the next render reuses the mounted avatar synchronously');
    assert.deepEqual(released, [], 'the former DOM lease survives until the successor commits');
    await second.commit();
    assert.equal(acquireCount, 1, 'an unchanged asset does not acquire a second Blob URL');

    const stale = coordinator.begin();
    await stale.load('unused-background');
    await stale.abort();
    assert.deepEqual(released, ['lease-2'], 'an aborted render releases only its unmounted resources');

    const empty = coordinator.begin();
    await empty.commit();
    assert.deepEqual(released, ['lease-2', 'lease-1'], 'the old visible lease releases after a successor stops using it');

    await coordinator.dispose();
    console.log('[qq-render-lease-coordinator] passed');
}

main().catch((error) => {
    console.error('[qq-render-lease-coordinator] failed');
    console.error(error);
    process.exitCode = 1;
});
