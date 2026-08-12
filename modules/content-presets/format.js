import { CONTENT_PRESET_API_VERSION, CONTENT_PRESET_FORMAT, CONTENT_PRESET_FORMAT_VERSION } from './constants.js';
import { normalizePackagePath } from './paths.js';

function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); }
function hasOnlyKeys(value, allowedKeys) {
    if (!isObject(value)) return false;
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every(key => allowed.has(key));
}
function isIssue(value) {
    return hasOnlyKeys(value, ['code', 'message', 'itemId'])
        && typeof value.code === 'string' && typeof value.message === 'string' && typeof value.itemId === 'string';
}
function stripNonCode(source) {
    let result = '';
    let index = 0;
    let quote = '';
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (quote) {
            if (char === '\\') { result += '  '; index += 2; continue; }
            if (char === quote) quote = '';
            result += char === '\n' ? '\n' : ' ';
            index += 1;
            continue;
        }
        if (char === '/' && next === '/') {
            const end = source.indexOf('\n', index);
            result += ' '.repeat((end < 0 ? source.length : end) - index);
            index = end < 0 ? source.length : end;
            continue;
        }
        if (char === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2);
            const comment = source.slice(index, end < 0 ? source.length : end + 2);
            result += comment.replace(/[^\n]/g, ' ');
            index = end < 0 ? source.length : end + 2;
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') quote = char;
        result += char;
        index += 1;
    }
    return result;
}
function hasMountExport(file) {
    if (!file || file.encoding !== 'text' || !/^(?:text|application)\/javascript$/i.test(text(file.mimeType))) return false;
    const source = stripNonCode(String(file.content ?? ''));
    return /^\s*export\s+(?:async\s+)?function\s+mount\s*\(\s*context\s*\)/m.test(source);
}
function isNormalizedPackagePath(value) {
    if (typeof value !== 'string' || value !== value.trim()) return false;
    try {
        return normalizePackagePath(value) === value;
    } catch {
        return false;
    }
}
function isTrustedFile(file) {
    return hasOnlyKeys(file, ['path', 'mimeType', 'encoding', 'content'])
        && isNormalizedPackagePath(file.path)
        && !!text(file.mimeType)
        && (file.encoding === 'text' || file.encoding === 'base64')
        && typeof file.content === 'string';
}
function isRawFile(file) {
    return hasOnlyKeys(file, ['mimeType', 'encoding', 'content'])
        && !!text(file.mimeType)
        && (file.encoding === 'text' || file.encoding === 'base64')
        && typeof file.content === 'string';
}
function isRawTarget(target) {
    return hasOnlyKeys(target, ['tableName', 'fields']) && Array.isArray(target.fields);
}
function isRawEntry(entry) {
    return hasOnlyKeys(entry, ['html', 'css', 'mount']);
}
function isRawItem(item) {
    return hasOnlyKeys(item, ['id', 'name', 'target', 'entry', 'assets'])
        && isRawTarget(item.target)
        && isRawEntry(item.entry)
        && (item.assets === undefined || Array.isArray(item.assets));
}
function isRawManifest(manifest) {
    return hasOnlyKeys(manifest, ['id', 'name', 'version', 'author', 'items'])
        && Array.isArray(manifest.items)
        && manifest.items.every(isRawItem);
}
function isTrustedTarget(target) {
    return hasOnlyKeys(target, ['tableName', 'fields']) && Array.isArray(target.fields);
}
function isTrustedEntry(entry) {
    return hasOnlyKeys(entry, ['html', 'css', 'mount']);
}
function isTrustedTextEntryFile(file, mimeType) {
    return isTrustedFile(file) && file.encoding === 'text' && text(file.mimeType).toLowerCase() === mimeType;
}

export function isContentPresetBundle(value) {
    return hasOnlyKeys(value, ['format', 'formatVersion', 'apiVersion', 'manifest', 'files'])
        && value.format === CONTENT_PRESET_FORMAT
        && value.formatVersion === CONTENT_PRESET_FORMAT_VERSION
        && value.apiVersion === CONTENT_PRESET_API_VERSION
        && isRawManifest(value.manifest)
        && isObject(value.files)
        && Object.entries(value.files).every(([path, file]) => isNormalizedPackagePath(path) && isRawFile(file));
}

export function isTrustedContentPresetRecord(value) {
    if (!hasOnlyKeys(value, ['id', 'name', 'version', 'author', 'format', 'formatVersion', 'apiVersion', 'manifest', 'files', 'items', 'issues', 'importedAt'])
        || value.format !== CONTENT_PRESET_FORMAT
        || value.formatVersion !== CONTENT_PRESET_FORMAT_VERSION
        || value.apiVersion !== CONTENT_PRESET_API_VERSION
        || !text(value.id)
        || !isRawManifest(value.manifest)
        || !Array.isArray(value.items)
        || !Array.isArray(value.issues)
        || !value.issues.every(isIssue)
        || typeof value.importedAt !== 'string') return false;
    const files = value.files;
    if (!isObject(files) || !Object.entries(files).every(([path, file]) => isNormalizedPackagePath(path) && file.path === path && isTrustedFile(file))) return false;
    const ids = new Set();
    return value.items.every((item) => {
        if (!hasOnlyKeys(item, ['id', 'name', 'target', 'entry', 'assets', 'issues', 'activatable'])
            || !text(item.id) || ids.has(item.id)
            || !isTrustedTarget(item.target)
            || !isTrustedEntry(item.entry)
            || !Array.isArray(item.assets)
            || !Array.isArray(item.issues)
            || !item.issues.every(isIssue)
            || typeof item.activatable !== 'boolean') return false;
        ids.add(item.id);
        const entry = item.entry;
        if (!isNormalizedPackagePath(entry.mount)) return false;
        if (!hasMountExport(files[entry.mount])) return false;
        if (hasOwn(entry, 'html') && (!isNormalizedPackagePath(entry.html) || !isTrustedTextEntryFile(files[entry.html], 'text/html'))) return false;
        if (hasOwn(entry, 'css') && (!isNormalizedPackagePath(entry.css) || !isTrustedTextEntryFile(files[entry.css], 'text/css'))) return false;
        if (!item.assets.every(path => isNormalizedPackagePath(path) && isTrustedFile(files[path]))) return false;
        return true;
    });
}

export function parseContentPresetBundle(input) {
    let value = input;
    if (typeof input === 'string') {
        try { value = JSON.parse(input); } catch (error) { throw new Error(`玉子美化预设不是有效 JSON：${error.message}`); }
    }
    if (!isContentPresetBundle(value)) {
        throw new Error(`不支持的玉子美化预设格式，需要 ${CONTENT_PRESET_FORMAT}@${CONTENT_PRESET_FORMAT_VERSION} apiVersion=${CONTENT_PRESET_API_VERSION}`);
    }
    return value;
}
