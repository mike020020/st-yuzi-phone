const IMAGE_LIBRARY_KEY = 'imageLibraryAssets';
const STICKERS_KEY = 'qq-v2.resources.stickers';
const INSTALLATION_KEY = 'qq-v2.resources.default-image-library-installed';
const INSTALLATION_VERSION = 1;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const CDN_ROOT = 'https://cdn.jsdelivr.net/gh/niccolecantdoit-rgb/pic-bed@main/img/u15/2026/08';

const freezeEntries = (entries) => Object.freeze(entries.map((entry) => Object.freeze(entry)));

export const QQ_DEFAULT_IMAGE_LIBRARY = Object.freeze({
    images: freezeEntries([
        { id: 'builtin-avatar-01', library: 'avatar', kind: 'avatar', file: 'cd9a6310-7fc5-4b47-b0b6-21f0c2e5b3df.jpg' },
        { id: 'builtin-avatar-02', library: 'avatar', kind: 'avatar', file: '5684ee54-9577-4a28-80ee-4e9fe49ba5fc.jpg' },
        { id: 'builtin-avatar-03', library: 'avatar', kind: 'avatar', file: '18565d16-e84d-42d7-98a3-02e4d57cb97c.jpg' },
        { id: 'builtin-avatar-04', library: 'avatar', kind: 'avatar', file: 'c793abe2-0ead-45e3-a448-0199644744e6.jpg' },
        { id: 'builtin-avatar-05', library: 'avatar', kind: 'avatar', file: 'b97ef4e3-af7a-40e3-bbde-96ae67e5acd5.jpg' },
        { id: 'builtin-avatar-06', library: 'avatar', kind: 'avatar', file: 'e3997054-88fb-4807-b2fd-0c2c27d689ed.jpg' },
        { id: 'builtin-avatar-07', library: 'avatar', kind: 'avatar', file: 'f5d2d8a7-468d-4884-abf2-9f0d04b395e8.jpg' },
        { id: 'builtin-avatar-08', library: 'avatar', kind: 'avatar', file: '6bf1204f-3cb1-4239-8aa6-38be35c986b4.jpg' },
        { id: 'builtin-profile-background-01', library: 'profile-background', kind: 'profile-background', file: 'a054f1d7-e1ef-4f0f-9b1f-c589995be236.jpg' },
        { id: 'builtin-chat-background-01', library: 'chat-background', kind: 'background', file: 'fb9476fc-57e2-428f-ab60-b86784712979.jpg' },
    ].map((entry) => ({ ...entry, url: `${CDN_ROOT}/${entry.file}` }))),
    stickers: freezeEntries([
        { id: 'builtin-sticker-serious', description: '正经', file: '037723af-b5a0-4e43-ac4f-04f3049dad04.jpg' },
        { id: 'builtin-sticker-playful', description: '不正经', file: '2171b847-007f-4298-8665-7847c86a5071.jpg' },
    ].map((entry) => ({ ...entry, url: `${CDN_ROOT}/${entry.file}` }))),
});

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isInstalled(state) {
    return Number(state.sharedResources?.[INSTALLATION_KEY]?.version) === INSTALLATION_VERSION;
}

function responseMimeType(response, blob) {
    const header = response?.headers?.get?.('content-type');
    return String(header || blob?.type || '').split(';', 1)[0].trim().toLowerCase();
}

async function downloadResource(definition, fetchImpl) {
    const response = await fetchImpl(definition.url);
    if (!response?.ok || typeof response.blob !== 'function') {
        throw new Error(`默认图片下载失败：${definition.id}`);
    }
    const blob = await response.blob();
    const mimeType = responseMimeType(response, blob);
    if (!(blob instanceof Blob) || !/^image\/[a-z0-9.+-]+$/u.test(mimeType)) {
        throw new Error(`默认图片格式无效：${definition.id}`);
    }
    if (blob.size <= 0 || blob.size > MAX_RESOURCE_BYTES) {
        throw new Error(`默认图片大小无效：${definition.id}`);
    }
    return {
        definition,
        blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
        mimeType,
    };
}

function installResources(state, downloads, installedAt) {
    if (isInstalled(state)) return false;
    const sharedResources = asObject(state.sharedResources);
    state.sharedResources = sharedResources;

    const imageAssets = asObject(sharedResources[IMAGE_LIBRARY_KEY]);
    downloads.images.forEach(({ definition, blob, mimeType }, index) => {
        if (Object.hasOwn(imageAssets, definition.id)) return;
        imageAssets[definition.id] = {
            assetId: definition.id,
            scopeId: '',
            conversationId: '',
            kind: definition.kind,
            library: definition.library,
            blob,
            mimeType,
            createdAt: installedAt - index,
        };
    });
    sharedResources[IMAGE_LIBRARY_KEY] = imageAssets;

    const stickerState = asObject(sharedResources[STICKERS_KEY]);
    const stickers = Array.isArray(stickerState.stickers) ? stickerState.stickers : [];
    const stickerIds = new Set(stickers.map((sticker) => String(sticker?.id ?? '').trim()).filter(Boolean));
    let nextOrder = stickers.reduce((highest, sticker) => Math.max(highest, Number(sticker?.order) || 0), -1) + 1;
    downloads.stickers.forEach(({ definition, blob, mimeType }) => {
        if (stickerIds.has(definition.id)) return;
        stickerIds.add(definition.id);
        stickers.push({
            id: definition.id,
            description: definition.description,
            blob,
            mimeType,
            size: blob.size,
            order: nextOrder,
        });
        nextOrder += 1;
    });
    sharedResources[STICKERS_KEY] = { ...stickerState, stickers };
    sharedResources[INSTALLATION_KEY] = { version: INSTALLATION_VERSION };
    return true;
}

export function createQQDefaultImageLibraryInstaller(options = {}) {
    const stateStore = options.stateStore;
    if (!stateStore || typeof stateStore.read !== 'function' || typeof stateStore.transact !== 'function') {
        throw new TypeError('QQ 默认图片资料需要有效的 state store');
    }
    const fetchImpl = options.fetchImpl;
    let pending = null;

    const install = async () => {
        if (isInstalled(await stateStore.read())) return { installed: false };
        if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持下载 QQ 默认图片资料');

        const [images, stickers] = await Promise.all([
            Promise.all(QQ_DEFAULT_IMAGE_LIBRARY.images.map((entry) => downloadResource(entry, fetchImpl))),
            Promise.all(QQ_DEFAULT_IMAGE_LIBRARY.stickers.map((entry) => downloadResource(entry, fetchImpl))),
        ]);
        const installedAt = Date.now();
        const installed = await stateStore.transact((state) => installResources(state, { images, stickers }, installedAt));
        return { installed };
    };

    return Object.freeze({
        ensureInstalled() {
            if (!pending) pending = install().finally(() => { pending = null; });
            return pending;
        },
    });
}
