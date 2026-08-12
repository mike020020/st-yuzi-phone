const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

/**
 * Public storage seam under test:
 * createQQV2SharedResourceStorage({ stateStore })
 * Shared resource keys live outside individual SillyTavern scopes.
 */
async function testSharedResourcesPersistOutsideChatScopes() {
    const {
        createMemoryQQV2StateStore,
        createQQV2SharedResourceStorage,
    } = await importModule('modules/qq-v2/storage/state-store.js');
    const stateStore = createMemoryQQV2StateStore();
    const writer = createQQV2SharedResourceStorage({ stateStore });
    const reader = createQQV2SharedResourceStorage({ stateStore });
    const key = 'qq-v2.resources.api-presets';
    const record = {
        presets: [{ id: 'api-1', endpoint: 'https://example.test/v1' }],
    };

    await writer.set(key, record);
    record.presets[0].endpoint = 'changed-after-save';

    assert.deepEqual(await reader.get(key), {
        presets: [{ id: 'api-1', endpoint: 'https://example.test/v1' }],
    });
    await stateStore.transact((state) => {
        state.scopes['st:character:a:chat'] = { value: 'scope only' };
    });
    assert.deepEqual(await reader.get(key), {
        presets: [{ id: 'api-1', endpoint: 'https://example.test/v1' }],
    });
    assert.equal(await reader.delete(key), true);
    assert.equal(await writer.get(key), undefined);
    assert.equal(await writer.delete(key), false);
}

async function main() {
    await testSharedResourcesPersistOutsideChatScopes();
    console.log('[qq-v2-shared-storage-contract] passed');
}

main().catch((error) => {
    console.error('[qq-v2-shared-storage-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
