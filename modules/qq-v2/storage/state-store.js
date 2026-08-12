const DB_NAME = 'yuzi-phone-qq-v2';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const STATE_KEY = 'root';

function clone(value) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

export function createEmptyQQV2State() {
    return {
        version: 2,
        scopes: {},
        sharedResources: {},
    };
}

function normalizeState(value) {
    const state = value && typeof value === 'object' ? clone(value) : createEmptyQQV2State();
    if (!state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes)) {
        state.scopes = {};
    }
    if (!state.sharedResources || typeof state.sharedResources !== 'object' || Array.isArray(state.sharedResources)) {
        state.sharedResources = {};
    }
    state.version = 2;
    return state;
}

function sharedResourceKey(value) {
    const key = String(value ?? '').trim();
    if (!key) throw new TypeError('QQ v2 shared resource storage needs a key');
    return key;
}

/**
 * Extension-wide key-value storage backed by the same atomic v2 IndexedDB
 * document. Its bucket is explicitly outside `scopes`, so an API preset or
 * sticker library never belongs to one SillyTavern chat.
 */
export function createQQV2SharedResourceStorage(options = {}) {
    const stateStore = options.stateStore;
    if (!stateStore || typeof stateStore.read !== 'function' || typeof stateStore.transact !== 'function') {
        throw new TypeError('QQ v2 shared resource storage needs a state store');
    }

    return Object.freeze({
        async get(key) {
            const state = await stateStore.read();
            return state.sharedResources?.[sharedResourceKey(key)];
        },
        async set(key, value) {
            const resourceKey = sharedResourceKey(key);
            await stateStore.transact((state) => {
                if (!state.sharedResources || typeof state.sharedResources !== 'object' || Array.isArray(state.sharedResources)) {
                    state.sharedResources = {};
                }
                state.sharedResources[resourceKey] = value;
            });
        },
        async delete(key) {
            const resourceKey = sharedResourceKey(key);
            return stateStore.transact((state) => {
                if (!state.sharedResources || typeof state.sharedResources !== 'object' || Array.isArray(state.sharedResources)) {
                    state.sharedResources = {};
                }
                if (!Object.hasOwn(state.sharedResources, resourceKey)) return false;
                delete state.sharedResources[resourceKey];
                return true;
            });
        },
    });
}

/** A test-friendly serial state store with the same public contract as IndexedDB. */
export function createMemoryQQV2StateStore(initialState = undefined) {
    let state = normalizeState(initialState);
    let pending = Promise.resolve();

    return Object.freeze({
        async read() {
            await pending;
            return clone(state);
        },
        transact(mutator) {
            const task = pending.then(async () => {
                const draft = clone(state);
                const result = await mutator(draft);
                state = normalizeState(draft);
                return clone(result);
            });
            pending = task.catch(() => {});
            return task;
        },
        async close() {},
    });
}

function requestResult(request, label) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(new Error(`${label}失败`)), { once: true });
    });
}

function transactionDone(transaction, label) {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(new Error(`${label}已中止`)), { once: true });
        transaction.addEventListener('error', () => reject(new Error(`${label}失败`)), { once: true });
    });
}

function openDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);
        request.addEventListener('upgradeneeded', () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        });
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(new Error('打开 QQ v2 本地数据库失败')), { once: true });
    });
}

/**
 * Browser persistence for v2. One atomically written state document keeps a multi-entity
 * domain mutation together without v1 schema migration or compatibility reads.
 */
export function createIndexedDbQQV2StateStore(options = {}) {
    const indexedDb = options.indexedDB || globalThis.indexedDB;
    if (!indexedDb || typeof indexedDb.open !== 'function') {
        throw new Error('当前环境不支持 IndexedDB');
    }
    let databasePromise = null;
    let pending = Promise.resolve();

    const database = () => {
        if (!databasePromise) databasePromise = openDatabase(indexedDb);
        return databasePromise;
    };
    const readState = async () => {
        const db = await database();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const record = await requestResult(transaction.objectStore(STORE_NAME).get(STATE_KEY), '读取 QQ v2 状态');
        await transactionDone(transaction, '读取 QQ v2 状态');
        return normalizeState(record?.value);
    };
    const writeState = async (state) => {
        const db = await database();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        transaction.objectStore(STORE_NAME).put({ id: STATE_KEY, value: normalizeState(state) });
        await transactionDone(transaction, '保存 QQ v2 状态');
    };

    return Object.freeze({
        async read() {
            await pending;
            return readState();
        },
        transact(mutator) {
            const task = pending.then(async () => {
                const draft = await readState();
                const result = await mutator(draft);
                await writeState(draft);
                return clone(result);
            });
            pending = task.catch(() => {});
            return task;
        },
        async close() {
            if (!databasePromise) return;
            const db = await databasePromise;
            db.close();
            databasePromise = null;
        },
    });
}
