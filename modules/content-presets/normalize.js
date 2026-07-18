import { DEFAULT_SCRIPT_MODE, SCRIPT_MODES } from './constants.js';
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

export function normalizeContentPresetBundle(bundle) {
    const manifest = bundle.manifest || {};
    const issues = [];
    const files = {};
    for (const [path, value] of Object.entries(normalizeFileTable(bundle.files))) files[path] = normalizeFile(path, value);
    const presetId = text(manifest.id) || generatedId('preset');
    if (!text(manifest.id)) issues.push(issue('generated_preset_id', 'manifest.id 缺失，已生成稳定内部 ID'));
    const seen = new Set();
    const items = (Array.isArray(manifest.items) ? manifest.items : []).map((source, index) => {
        const itemIssues = [];
        let id = text(source?.id);
        if (!id || seen.has(id)) {
            itemIssues.push(issue(id ? 'duplicate_item_id' : 'generated_item_id', id ? `itemId 重复：${id}` : 'itemId 缺失，已生成内部 ID', id));
            id = generatedId(`item-${index + 1}`);
        }
        seen.add(id);
        const entry = {};
        for (const kind of ['html', 'css', 'js']) {
            const rawPath = text(source?.entry?.[kind]);
            if (!rawPath) continue;
            try {
                entry[kind] = normalizePackagePath(rawPath);
                if (!files[entry[kind]]) itemIssues.push(issue('missing_entry', `${kind} 入口文件不存在：${entry[kind]}`, id));
            } catch (error) {
                itemIssues.push(issue('invalid_entry', error.message, id));
            }
        }
        const requestedMode = text(source?.entry?.scriptMode || source?.scriptMode).toLowerCase();
        const scriptMode = SCRIPT_MODES.includes(requestedMode) ? requestedMode : DEFAULT_SCRIPT_MODE;
        if (entry.js && requestedMode && requestedMode !== scriptMode) itemIssues.push(issue('invalid_script_mode', `脚本模式无效，已归一化为 ${scriptMode}`, id));
        const hasHtml = !!entry.html && !!files[entry.html];
        const hasJs = !!entry.js && !!files[entry.js];
        const activatable = hasHtml || hasJs;
        if (!activatable) itemIssues.push(issue('not_activatable', '单项没有可用 HTML 或 JavaScript 入口', id));
        issues.push(...itemIssues);
        return Object.freeze({
            id,
            name: text(source?.name) || id,
            target: Object.freeze({ tableName: text(source?.target?.tableName), fields: Object.freeze((Array.isArray(source?.target?.fields) ? source.target.fields : []).map(text).filter(Boolean)) }),
            entry: Object.freeze({ ...entry, scriptMode }),
            assets: Object.freeze(Array.isArray(source?.assets) ? source.assets.map(text).filter(Boolean) : []),
            issues: Object.freeze(itemIssues),
            activatable,
        });
    });
    return Object.freeze({
        id: presetId,
        name: text(manifest.name) || presetId,
        version: text(manifest.version), author: text(manifest.author),
        format: bundle.format, formatVersion: Number(bundle.formatVersion),
        manifest: Object.freeze({ ...manifest, id: presetId }), files: Object.freeze(files),
        items: Object.freeze(items), issues: Object.freeze(issues), importedAt: new Date().toISOString(),
    });
}
