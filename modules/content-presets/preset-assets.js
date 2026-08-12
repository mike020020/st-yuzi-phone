import { enqueueContentPresetMutation } from './mutation-coordinator.js';
import { getPresetRecord, updatePresetFiles } from './repository.js';

const slotQueues = new Map();
const EXTENSION_BY_MIME = Object.freeze({
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/vnd.microsoft.icon': 'ico',
    'image/webp': 'webp',
    'image/x-icon': 'ico',
});
const MANAGED_EXTENSIONS = Object.freeze([...new Set([...Object.values(EXTENSION_BY_MIME), 'image'])]);

const DEFAULT_DEPS = Object.freeze({
    decodeImage: decodeImageBlob,
    enqueueContentPresetMutation,
    getPresetRecord,
    updatePresetFiles,
});

function resolveSlot(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('图片资源槽不能为空');
    try {
        const basePath = `user-assets/${encodeURIComponent(value)}`;
        return Object.freeze({ basePath, paths: Object.freeze(MANAGED_EXTENSIONS.map(extension => `${basePath}.${extension}`)) });
    } catch {
        throw new Error('图片资源槽包含无法编码的字符');
    }
}

function extensionFor(blob) {
    return EXTENSION_BY_MIME[String(blob.type || '').split(';', 1)[0].trim().toLowerCase()] || 'image';
}

function enqueueSlotTask(key, task) {
    const previous = slotQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    slotQueues.set(key, next);
    const clear = () => { if (slotQueues.get(key) === next) slotQueues.delete(key); };
    next.then(clear, clear);
    return next;
}

async function decodeImageBlob(blob) {
    let url = '';
    try {
        url = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('图片无法解码'));
            image.src = url;
        });
    } catch {
        throw new Error('图片无法解码');
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function fileToBlob(file, BlobCtor) {
    if (file.encoding !== 'base64') return new BlobCtor([String(file.content ?? '')], { type: file.mimeType });
    const binary = atob(file.content);
    return new BlobCtor([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: file.mimeType });
}

export function createPresetAssetsRuntime(presetId, options = {}) {
    const id = String(presetId ?? '').trim();
    if (!id) throw new Error('预设 ID 不能为空');
    const runtimeDeps = { ...DEFAULT_DEPS, ...options };
    const BlobCtor = options.BlobCtor || Blob;
    const createObjectURL = options.createObjectURL || URL.createObjectURL;
    const revokeObjectURL = options.revokeObjectURL || URL.revokeObjectURL;
    const urls = new Map();
    let live = true;

    const assertLive = () => {
        if (!live) throw new Error('预设图片运行时已失效');
    };
    const revokeUrl = (path) => {
        const url = urls.get(path);
        if (!url) return;
        urls.delete(path);
        revokeObjectURL(url);
    };
    const cacheUrl = (path, blob) => {
        const url = createObjectURL(blob);
        revokeUrl(path);
        urls.set(path, url);
        return url;
    };
    const persist = (removePaths, file) => runtimeDeps.enqueueContentPresetMutation(
        () => { assertLive(); return runtimeDeps.updatePresetFiles(id, { removePaths, file }); },
        () => null,
    );
    const runForSlot = (slot, task) => {
        const resolved = resolveSlot(slot);
        return enqueueSlotTask(`${id}\0${resolved.basePath}`, () => task(resolved));
    };

    return Object.freeze({
        async getUrl(slot) {
            return runForSlot(slot, async ({ basePath, paths }) => {
                assertLive();
                if (urls.has(basePath)) return urls.get(basePath);
                const record = await runtimeDeps.getPresetRecord(id);
                assertLive();
                if (!record) throw new Error(`预设不存在：${id}`);
                const file = paths.map(path => record.files?.[path]).find(Boolean);
                return file ? cacheUrl(basePath, fileToBlob(file, BlobCtor)) : null;
            });
        },
        async save(slot, image) {
            return runForSlot(slot, async ({ basePath, paths }) => {
                assertLive();
                if (!(image instanceof BlobCtor)) throw new Error('只能保存图片 Blob');
                await runtimeDeps.decodeImage(image);
                assertLive();
                const content = await blobToBase64(image);
                assertLive();
                const path = `${basePath}.${extensionFor(image)}`;
                await persist(paths, {
                    path,
                    mimeType: String(image.type || '').trim() || 'application/octet-stream',
                    encoding: 'base64',
                    content,
                });
                assertLive();
                return cacheUrl(basePath, image);
            });
        },
        async delete(slot) {
            return runForSlot(slot, async ({ basePath, paths }) => {
                assertLive();
                await persist(paths, null);
                assertLive();
                revokeUrl(basePath);
            });
        },
        dispose() {
            if (!live) return;
            live = false;
            for (const path of [...urls.keys()]) revokeUrl(path);
        },
    });
}
