const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const DRIVE_PATTERN = /^[a-z]:/i;

export function stripReferenceSuffix(value) {
    return String(value ?? '').split(/[?#]/, 1)[0];
}

export function normalizePackagePath(value) {
    const raw = stripReferenceSuffix(value).trim();
    if (!raw) throw new Error('包路径不能为空');
    if (raw.includes('\\')) throw new Error(`包路径不得包含反斜杠：${raw}`);
    if (raw.startsWith('/') || DRIVE_PATTERN.test(raw) || SCHEME_PATTERN.test(raw)) {
        throw new Error(`包路径必须是相对路径：${raw}`);
    }
    const segments = raw.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`包路径包含无效段：${raw}`);
    }
    return segments.join('/');
}

export function normalizeFileTable(files) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
    const normalized = {};
    for (const [sourcePath, file] of Object.entries(files)) {
        const path = normalizePackagePath(sourcePath);
        if (Object.prototype.hasOwnProperty.call(normalized, path)) {
            throw new Error(`包路径规范化后重复：${path}`);
        }
        normalized[path] = file;
    }
    return normalized;
}

export function resolvePackageReference(basePath, reference) {
    const ref = stripReferenceSuffix(reference).trim();
    if (!ref || ref.startsWith('#') || SCHEME_PATTERN.test(ref) || ref.startsWith('//')) return null;
    if (ref.startsWith('/') || DRIVE_PATTERN.test(ref) || ref.includes('\\')) {
        throw new Error(`资源引用越界：${reference}`);
    }
    const base = normalizePackagePath(basePath).split('/');
    base.pop();
    for (const segment of ref.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (base.length === 0) throw new Error(`资源引用越界：${reference}`);
            base.pop();
        } else {
            base.push(segment);
        }
    }
    return normalizePackagePath(base.join('/'));
}
