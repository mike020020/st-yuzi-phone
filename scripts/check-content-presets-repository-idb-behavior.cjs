const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const cloneMap = source => new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
const freshRepository = () => import(`${pathToFileURL(path.join(process.cwd(), 'modules/content-presets/repository.js')).href}?t=${Date.now()}-${Math.random()}`);
const turn = () => new Promise(resolve => setImmediate(resolve));

function createHarness({ seed = {}, autoComplete = true, requestError = null, deleteErrorKey = null } = {}) {
    const committed = {
        presets: new Map((seed.presets || []).map(value => [value.id, structuredClone(value)])),
        activeByTable: new Map((seed.activeByTable || []).map(value => [value.sheetKey, structuredClone(value)])),
    };
    const transactions = [];

    class Transaction {
        constructor(storeNames, mode) {
            this.storeNames = [...storeNames];
            this.mode = mode;
            this.staged = {
                presets: cloneMap(committed.presets),
                activeByTable: cloneMap(committed.activeByTable),
            };
            this.aborted = false;
            this.completed = false;
            this.abortCalls = 0;
            this.oncomplete = null;
            this.onerror = null;
            this.onabort = null;
        }
        objectStore(name) {
            assert.ok(this.storeNames.includes(name));
            const map = this.staged[name];
            const tx = this;
            return {
                put(record) { map.set(record.id, structuredClone(record)); },
                delete(key) {
                    if (name === 'activeByTable' && key === deleteErrorKey) throw new Error('fixture binding delete failed');
                    map.delete(key);
                },
                index(indexName) {
                    assert.equal(name, 'activeByTable');
                    assert.equal(indexName, 'presetId');
                    return {
                        getAll(presetId) {
                            const request = { result: undefined, error: null, onsuccess: null, onerror: null };
                            queueMicrotask(() => {
                                if (requestError) {
                                    request.error = requestError;
                                    request.onerror?.();
                                    return;
                                }
                                request.result = [...map.values()].filter(record => record.presetId === String(presetId)).map(record => structuredClone(record));
                                request.onsuccess?.();
                                if (autoComplete) setImmediate(() => tx.complete());
                            });
                            return request;
                        },
                    };
                },
            };
        }
        abort() {
            if (this.aborted || this.completed) return;
            this.abortCalls += 1;
            this.aborted = true;
            queueMicrotask(() => this.onabort?.());
        }
        complete() {
            if (this.aborted || this.completed) return;
            committed.presets = cloneMap(this.staged.presets);
            committed.activeByTable = cloneMap(this.staged.activeByTable);
            this.completed = true;
            this.oncomplete?.();
        }
    }

    const db = {
        close() {},
        onversionchange: null,
        transaction(storeNames, mode) {
            const tx = new Transaction(storeNames, mode);
            transactions.push(tx);
            return tx;
        },
    };
    const factory = {
        open() {
            const request = { result: db, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    };
    return { factory, committed, transactions, get lastTransaction() { return transactions.at(-1); } };
}


const seed = {
    presets: [{ id: 'preset-1', name: 'Old' }, { id: 'preset-2', name: 'Other' }],
    activeByTable: [
        { sheetKey: 'sheet-a', presetId: 'preset-1', itemId: 'old-a' },
        { sheetKey: 'sheet-b', presetId: 'preset-1', itemId: 'old-b' },
        { sheetKey: 'preset-1', presetId: 'preset-2', itemId: 'other-key' },
        { sheetKey: 'sheet-c', presetId: 'preset-2', itemId: 'other' },
    ],
};

async function setup(options = {}) {
    const harness = createHarness({ seed, ...options });
    globalThis.indexedDB = harness.factory;
    return { harness, repository: await freshRepository() };
}

function assertTransaction(tx) {
    assert.deepEqual(tx.storeNames, ['presets', 'activeByTable']);
    assert.equal(tx.mode, 'readwrite');
}

async function main() {
    const originalIndexedDb = globalThis.indexedDB;
    try {
        {
            const { harness, repository } = await setup();
            const record = { id: 'preset-1', name: 'New' };
            const result = await repository.replacePresetRecord(record);
            assert.equal(harness.transactions.length, 1);
            assertTransaction(harness.lastTransaction);
            assert.deepEqual(result, { record, affectedSheetKeys: ['sheet-a', 'sheet-b'] });
            assert.deepEqual(harness.committed.presets.get('preset-1'), record);
            assert.equal(harness.committed.activeByTable.has('sheet-a'), false);
            assert.equal(harness.committed.activeByTable.has('sheet-b'), false);
            assert.equal(harness.committed.activeByTable.has('preset-1'), true, '不得把 presetId 错当 sheetKey 删除');
            assert.equal(harness.committed.activeByTable.has('sheet-c'), true);
        }

        {
            const { harness, repository } = await setup();
            const result = await repository.deletePresetRecord(' preset-1 ');
            assertTransaction(harness.lastTransaction);
            assert.deepEqual(result, { presetId: 'preset-1', affectedSheetKeys: ['sheet-a', 'sheet-b'] });
            assert.equal(harness.committed.presets.has('preset-1'), false);
            assert.equal(harness.committed.activeByTable.has('sheet-a'), false);
            assert.equal(harness.committed.activeByTable.has('sheet-b'), false);
            assert.equal(harness.committed.activeByTable.has('preset-1'), true);
        }

        {
            const { harness, repository } = await setup({ requestError: new Error('fixture binding lookup failed') });
            await assert.rejects(() => repository.replacePresetRecord({ id: 'preset-1', name: 'Broken' }), /fixture binding lookup failed/);
            assert.equal(harness.lastTransaction.abortCalls, 1);
            assert.equal(harness.lastTransaction.completed, false);
            assert.equal(harness.committed.presets.get('preset-1').name, 'Old');
            assert.equal(harness.committed.activeByTable.has('sheet-a'), true);
        }

        {
            const { harness, repository } = await setup({ deleteErrorKey: 'sheet-b' });
            await assert.rejects(() => repository.deletePresetRecord('preset-1'), /fixture binding delete failed/);
            assert.equal(harness.lastTransaction.abortCalls, 1);
            assert.equal(harness.lastTransaction.completed, false);
            assert.equal(harness.committed.presets.has('preset-1'), true);
            assert.equal(harness.committed.activeByTable.has('sheet-a'), true, '部分 staged 删除必须回滚');
            assert.equal(harness.committed.activeByTable.has('sheet-b'), true);
        }

        for (const [label, invoke] of [
            ['replace', repository => repository.replacePresetRecord({ id: 'preset-1', name: 'Manual' })],
            ['delete', repository => repository.deletePresetRecord('preset-1')],
        ]) {
            const { harness, repository } = await setup({ autoComplete: false });
            let settled = false;
            const promise = invoke(repository).then(result => { settled = true; return result; });
            await turn();
            assert.equal(settled, false, `${label} 不得在 transaction complete 前 resolve`);
            assert.equal(harness.committed.presets.get('preset-1').name, 'Old');
            harness.lastTransaction.complete();
            await promise;
            assert.equal(settled, true);
        }
    } finally {
        if (originalIndexedDb === undefined) delete globalThis.indexedDB;
        else globalThis.indexedDB = originalIndexedDb;
    }

    console.log('[content-presets-repository-idb-behavior-check] 检查通过');
}

main().catch(error => {
    console.error('[content-presets-repository-idb-behavior-check] 检查失败');
    console.error(error);
    process.exitCode = 1;
});
