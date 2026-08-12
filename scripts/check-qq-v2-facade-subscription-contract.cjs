const assert = require('node:assert/strict');

async function main() {
    const { createQQV2Facade } = await import('../modules/qq-v2/application/facade.js');
    let scopeId = 'scope-a';
    const listeners = new Set();
    const runtime = {
        async getSnapshot() {
            return {
                phase: 'ready',
                context: {
                    scopeId,
                    user: { name: 'Traveler', avatar: '' },
                    storyTime: '2042-05-20 09:30',
                    privateHostState: 'must-not-leak',
                },
            };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const emit = async () => {
        for (const listener of [...listeners]) await listener({ privateRuntimeState: 'must-not-leak' });
    };
    const facade = createQQV2Facade({ runtime });
    const receivedA = [];
    const unsubscribeA = await facade.subscribe((event) => receivedA.push(event));

    assert.equal(typeof unsubscribeA, 'function');
    await emit();
    assert.deepEqual(receivedA, [{ status: 'changed', scopeId: 'scope-a' }]);
    assert.equal(JSON.stringify(receivedA).includes('must-not-leak'), false);

    scopeId = 'scope-b';
    await emit();
    assert.deepEqual(receivedA, [{ status: 'changed', scopeId: 'scope-a' }]);

    unsubscribeA();
    scopeId = 'scope-a';
    await emit();
    assert.deepEqual(receivedA, [{ status: 'changed', scopeId: 'scope-a' }]);

    scopeId = 'scope-b';
    const receivedB = [];
    const unsubscribeB = await facade.subscribe((event) => receivedB.push(event));
    await emit();
    assert.deepEqual(receivedB, [{ status: 'changed', scopeId: 'scope-b' }]);
    unsubscribeB();
}

main().then(() => console.log('[qq-v2-facade-subscription-contract] passed')).catch((error) => {
    console.error('[qq-v2-facade-subscription-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
