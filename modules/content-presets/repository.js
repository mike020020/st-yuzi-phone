import {
    CONTENT_PRESET_BINDING_INDEX, CONTENT_PRESET_DB_NAME, CONTENT_PRESET_DB_VERSION, CONTENT_PRESET_STORES,
} from './constants.js';
import { isTrustedContentPresetRecord } from './format.js';
import { normalizePackagePath } from './paths.js';

let dbPromise = null;

function openRequest(factory = globalThis.indexedDB) {
    if (!factory?.open) throw new Error('IndexedDB 不可用');
    return factory.open(CONTENT_PRESET_DB_NAME, CONTENT_PRESET_DB_VERSION);
}

export function openContentPresetRepository(factory = globalThis.indexedDB) {
    if (factory === globalThis.indexedDB && dbPromise) return dbPromise;
    const promise = new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        let request;
        try { request = openRequest(factory); } catch (error) { fail(error); return; }
        request.onerror = () => fail(request.error || new Error('打开玉子美化数据库失败'));
        request.onblocked = () => fail(new DOMException('玉子美化数据库升级被阻塞', 'BlockedError'));
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CONTENT_PRESET_STORES.presets)) {
                db.createObjectStore(CONTENT_PRESET_STORES.presets, { keyPath: 'id' });
            }
            let bindings;
            if (!db.objectStoreNames.contains(CONTENT_PRESET_STORES.activeByTable)) {
                bindings = db.createObjectStore(CONTENT_PRESET_STORES.activeByTable, { keyPath: 'sheetKey' });
            } else {
                bindings = request.transaction.objectStore(CONTENT_PRESET_STORES.activeByTable);
            }
            if (!bindings.indexNames.contains(CONTENT_PRESET_BINDING_INDEX)) {
                bindings.createIndex(CONTENT_PRESET_BINDING_INDEX, 'presetId', { unique: false });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            if (settled) {
                db.close();
                return;
            }
            settled = true;
            db.onversionchange = () => { db.close(); if (dbPromise === promise) dbPromise = null; };
            resolve(db);
        };
    });
    if (factory === globalThis.indexedDB) {
        dbPromise = promise;
        promise.catch(() => { if (dbPromise === promise) dbPromise = null; });
    }
    return promise;
}

function runTransaction(db, stores, mode, operation) {
    return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(stores, mode); } catch (error) { reject(error); return; }
        let settled = false;
        let transactionCompleted = false;
        let operationCompleted = false;
        let operationValue;
        const fail = error => { if (!settled) { settled = true; reject(error || tx.error || new Error('玉子美化数据库事务失败')); } };
        const abortAndFail = (error) => {
            if (settled) return;
            try { tx.abort(); } catch {}
            fail(error);
        };
        const succeedIfReady = () => {
            if (settled || !transactionCompleted || !operationCompleted) return;
            settled = true;
            resolve(operationValue);
        };
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error || new DOMException('事务已中止', 'AbortError'));
        tx.oncomplete = () => {
            transactionCompleted = true;
            succeedIfReady();
        };
        let result;
        try { result = operation(tx); } catch (error) { abortAndFail(error); return; }
        Promise.resolve(result).then((value) => {
            operationValue = value;
            operationCompleted = true;
            succeedIfReady();
        }, abortAndFail);
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
    });
}

export async function listPresetMetadata() {
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets], 'readonly', tx => requestResult(tx.objectStore(CONTENT_PRESET_STORES.presets).getAll())
        .then(records => records.filter(isTrustedContentPresetRecord)
            .map(record => ({ id: record.id, name: record.name, version: record.version, author: record.author, itemCount: record.items.length, issues: record.issues || [], importedAt: record.importedAt }))));
}

export async function listPresetRecords() {
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets], 'readonly', tx => requestResult(tx.objectStore(CONTENT_PRESET_STORES.presets).getAll())
        .then(records => records.filter(isTrustedContentPresetRecord)));
}

export async function getPresetRecord(id) {
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets], 'readonly', tx => requestResult(tx.objectStore(CONTENT_PRESET_STORES.presets).get(String(id)))
        .then(record => isTrustedContentPresetRecord(record) ? record : null));
}

export async function loadActiveBindings() {
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets, CONTENT_PRESET_STORES.activeByTable], 'readonly', async (tx) => {
        const [presets, bindings] = await Promise.all([
            requestResult(tx.objectStore(CONTENT_PRESET_STORES.presets).getAll()),
            requestResult(tx.objectStore(CONTENT_PRESET_STORES.activeByTable).getAll()),
        ]);
        const validItems = new Map(presets.filter(isTrustedContentPresetRecord).map((preset) => [
            String(preset?.id ?? '').trim(),
            new Set((Array.isArray(preset?.items) ? preset.items : [])
                .filter(item => item?.activatable && text(item?.entry?.mount) && item?.entry?.mount === text(item.entry.mount))
                .map(item => String(item.id ?? '').trim())
                .filter(Boolean)),
        ]).filter(([presetId]) => presetId));
        return new Map(bindings.map((binding) => ({
            sheetKey: String(binding?.sheetKey ?? '').trim(),
            presetId: String(binding?.presetId ?? '').trim(),
            itemId: String(binding?.itemId ?? '').trim(),
        })).filter(binding => binding.sheetKey
            && binding.presetId
            && binding.itemId
            && validItems.get(binding.presetId)?.has(binding.itemId))
            .map(binding => [binding.sheetKey, binding]));
    });
}

function text(value) { return String(value ?? '').trim(); }

function writeValidatedBinding(tx, record) {
    const presetStore = tx.objectStore(CONTENT_PRESET_STORES.presets);
    const bindingStore = tx.objectStore(CONTENT_PRESET_STORES.activeByTable);
    return new Promise((resolve, reject) => {
        let request;
        try { request = presetStore.get(record.presetId); } catch (error) { reject(error); return; }
        request.onerror = () => reject(request.error || new Error('读取绑定预设失败'));
        request.onsuccess = () => {
            try {
                const preset = request.result;
                if (!isTrustedContentPresetRecord(preset)) {
                    reject(new Error('绑定引用的预设不符合 v2 Runtime API 合同'));
                    return;
                }
                const item = preset?.items?.find(entry => entry.id === record.itemId);
                if (!item?.activatable || !text(item.entry?.mount)) { reject(new Error('绑定引用的预设项不存在或不可运行')); return; }
                bindingStore.put(record);
                resolve(record);
            } catch (error) {
                reject(error);
            }
        };
    });
}

export async function setActiveBinding(sheetKey, presetId, itemId) {
    const record = {
        sheetKey: String(sheetKey ?? '').trim(),
        presetId: String(presetId ?? '').trim(),
        itemId: String(itemId ?? '').trim(),
    };
    if (!record.sheetKey || !record.presetId || !record.itemId) throw new Error('绑定缺少 sheetKey、presetId 或 itemId');
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets, CONTENT_PRESET_STORES.activeByTable], 'readwrite', (tx) => {
        return writeValidatedBinding(tx, record);
    });
}

export async function clearActiveBinding(sheetKey) {
    const key = String(sheetKey ?? '').trim();
    if (!key) return false;
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.activeByTable], 'readwrite', (tx) => {
        tx.objectStore(CONTENT_PRESET_STORES.activeByTable).delete(key);
        return true;
    });
}

export async function clearAllActiveBindings() {
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.activeByTable], 'readwrite', (tx) => {
        tx.objectStore(CONTENT_PRESET_STORES.activeByTable).clear();
        return true;
    });
}

function removePresetBindings(tx, presetId) {
    const store = tx.objectStore(CONTENT_PRESET_STORES.activeByTable);
    const index = store.index(CONTENT_PRESET_BINDING_INDEX);
    return new Promise((resolve, reject) => {
        let request;
        try { request = index.getAll(String(presetId)); } catch (error) { reject(error); return; }
        request.onerror = () => reject(request.error || new Error('读取预设绑定失败'));
        request.onsuccess = () => {
            try {
                const affectedSheetKeys = request.result
                    .map(record => String(record?.sheetKey ?? '').trim())
                    .filter(Boolean);
                for (const sheetKey of affectedSheetKeys) {
                    store.delete(sheetKey);
                }
                resolve(affectedSheetKeys);
            } catch (error) {
                reject(error);
            }
        };
    });
}

export async function replacePresetRecord(record) {
    if (!isTrustedContentPresetRecord(record)) throw new Error('预设记录不符合 v2 Runtime API 合同');
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets, CONTENT_PRESET_STORES.activeByTable], 'readwrite', (tx) => {
        tx.objectStore(CONTENT_PRESET_STORES.presets).put(record);
        return removePresetBindings(tx, record.id).then(affectedSheetKeys => ({ record, affectedSheetKeys }));
    });
}

export async function updatePresetFiles(presetId, patch = {}) {
    const id = String(presetId ?? '').trim();
    if (!id) throw new Error('预设 ID 不能为空');
    const removePaths = [...new Set((Array.isArray(patch.removePaths) ? patch.removePaths : []).map(normalizePackagePath))];
    const file = patch.file == null ? null : { ...patch.file, path: normalizePackagePath(patch.file.path) };
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets], 'readwrite', (tx) => new Promise((resolve, reject) => {
        const store = tx.objectStore(CONTENT_PRESET_STORES.presets);
        let request;
        try { request = store.get(id); } catch (error) { reject(error); return; }
        request.onerror = () => reject(request.error || new Error('读取预设失败'));
        request.onsuccess = () => {
            try {
                const current = request.result;
                if (!isTrustedContentPresetRecord(current)) throw new Error(`预设不存在或记录无效：${id}`);
                const files = { ...current.files };
                for (const path of removePaths) delete files[path];
                if (file) files[file.path] = file;
                const record = { ...current, files };
                if (!isTrustedContentPresetRecord(record)) throw new Error('更新后的预设记录不符合 v2 Runtime API 合同');
                store.put(record);
                resolve(record);
            } catch (error) {
                reject(error);
            }
        };
    }));
}

export async function deletePresetRecord(presetId) {
    const id = String(presetId ?? '').trim();
    if (!id) throw new Error('预设 ID 不能为空');
    const db = await openContentPresetRepository();
    return runTransaction(db, [CONTENT_PRESET_STORES.presets, CONTENT_PRESET_STORES.activeByTable], 'readwrite', (tx) => {
        tx.objectStore(CONTENT_PRESET_STORES.presets).delete(id);
        return removePresetBindings(tx, id).then(affectedSheetKeys => ({ presetId: id, affectedSheetKeys }));
    });
}

export async function getPresetExportRecord(presetId) {
    return getPresetRecord(presetId);
}
