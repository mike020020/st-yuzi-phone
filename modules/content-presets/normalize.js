import { isTrustedContentPresetRecord } from './format.js';
import { normalizeFileTable, normalizePackagePath } from './paths.js';

function text(value) { return String(value ?? '').trim(); }
function generatedId(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
}
function issue(code, message, itemId = '') { return Object.freeze({ code, message, itemId }); }
function normalizeFile(path, value) {
    const encoding = value?.encoding === 'base64' ? 'base64' : 'text';
    return Object.freeze({ path, mimeType: text(value?.mimeType) || 'application/octet-stream', encoding, content: String(value?.content ?? '') });
}
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
function requireEntryPath(source, kind, files, itemId) {
    const rawPath = text(source?.entry?.[kind]);
    if (!rawPath) throw new Error(`v2 预设项 ${itemId} 缺少 entry.${kind}`);
    const path = normalizePackagePath(rawPath);
    if (!files[path]) throw new Error(`v2 预设项 ${itemId} 的 ${kind} 入口文件不存在：${path}`);
    return path;
}

export function normalizeContentPresetBundle(bundle) {
    const sourceManifest = bundle.manifest || {};
    const manifest = {
        id: sourceManifest.id,
        name: sourceManifest.name,
        version: sourceManifest.version,
        author: sourceManifest.author,
        items: Array.isArray(sourceManifest.items) ? sourceManifest.items : [],
    };
    const files = {};
    for (const [path, value] of Object.entries(normalizeFileTable(bundle.files))) files[path] = normalizeFile(path, value);
    const presetId = text(manifest.id) || generatedId('preset');
    const issues = text(manifest.id) ? [] : [issue('generated_preset_id', 'manifest.id 缺失，已生成稳定内部 ID')];
    const seen = new Set();
    const items = (Array.isArray(manifest.items) ? manifest.items : []).map((source, index) => {
        if (hasOwn(source, 'scriptMode') || hasOwn(source?.entry, 'scriptMode') || hasOwn(source?.entry, 'js')) {
            throw new Error('v2 预设不接受 scriptMode 或 entry.js；请使用 entry.mount');
        }
        let id = text(source?.id);
        if (!id || seen.has(id)) {
            id = generatedId(`item-${index + 1}`);
            issues.push(issue('generated_item_id', 'itemId 缺失或重复，已生成内部 ID', id));
        }
        seen.add(id);
        const entry = { mount: requireEntryPath(source, 'mount', files, id) };
        for (const kind of ['html', 'css']) {
            const rawPath = text(source?.entry?.[kind]);
            if (!rawPath) continue;
            const path = normalizePackagePath(rawPath);
            if (!files[path]) throw new Error(`v2 预设项 ${id} 的 ${kind} 入口文件不存在：${path}`);
            entry[kind] = path;
        }
        return Object.freeze({
            id,
            name: text(source?.name) || id,
            target: Object.freeze({ tableName: text(source?.target?.tableName), fields: Object.freeze((Array.isArray(source?.target?.fields) ? source.target.fields : []).map(text).filter(Boolean)) }),
            entry: Object.freeze(entry),
            assets: Object.freeze(Array.isArray(source?.assets) ? source.assets.map(text).filter(Boolean) : []),
            issues: Object.freeze([]),
            activatable: true,
        });
    });
    const record = Object.freeze({
        id: presetId,
        name: text(manifest.name) || presetId,
        version: text(manifest.version), author: text(manifest.author),
        format: bundle.format, formatVersion: bundle.formatVersion, apiVersion: bundle.apiVersion,
        manifest: Object.freeze({ ...manifest, id: presetId }), files: Object.freeze(files),
        items: Object.freeze(items), issues: Object.freeze(issues), importedAt: new Date().toISOString(),
    });
    if (!isTrustedContentPresetRecord(record)) throw new Error('v2 预设缺少有效的 ES Module mount(context) 导出');
    return record;
}
