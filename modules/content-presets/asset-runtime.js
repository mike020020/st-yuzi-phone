import { resolvePackageReference, stripReferenceSuffix } from './paths.js';

function decodeFile(file) {
    if (file.encoding === 'base64') {
        const binary = atob(file.content);
        return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    return file.content;
}

export function createAssetRuntime(record) {
    const urls = new Map();
    const resolveAsset = (path) => {
        if (urls.has(path)) return urls.get(path);
        const file = record.files?.[path];
        if (!file) throw new Error(`资源不存在：${path}`);
        const url = URL.createObjectURL(new Blob([decodeFile(file)], { type: file.mimeType }));
        urls.set(path, url);
        return url;
    };
    const rewriteReference = (basePath, reference) => {
        const rawReference = String(reference ?? '').trim();
        const packagePath = resolvePackageReference(basePath, rawReference);
        if (!packagePath) return reference;
        const pathPart = stripReferenceSuffix(rawReference);
        const suffix = rawReference.slice(pathPart.length);
        return `${resolveAsset(packagePath)}${suffix}`;
    };
    const rewriteSrcset = (value, basePath) => String(value || '').replace(/(?:data:[^\s]+|[^\s,]+)(?:\s+[^,]+)?/gi, (candidate) => {
        const trimmed = candidate.trim();
        const separator = trimmed.search(/\s/);
        const url = separator < 0 ? trimmed : trimmed.slice(0, separator);
        const descriptor = separator < 0 ? '' : trimmed.slice(separator);
        try { return `${rewriteReference(basePath, url)}${descriptor}`; } catch { return trimmed; }
    });
    const rewriteHtml = (html, basePath) => String(html || '').replace(/\b(src|href|poster)\s*=\s*(['"])(.*?)\2/gi, (match, attr, quote, value) => {
        try { return `${attr}=${quote}${rewriteReference(basePath, value)}${quote}`; } catch { return match; }
    }).replace(/\bsrcset\s*=\s*(['"])(.*?)\1/gi, (match, quote, value) => {
        return `srcset=${quote}${rewriteSrcset(value, basePath)}${quote}`;
    });
    const rewriteCss = (css, basePath) => String(css || '').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, value) => {
        try { return `url(${quote}${rewriteReference(basePath, value)}${quote})`; } catch { return match; }
    });
    return Object.freeze({ resolveAsset, rewriteHtml, rewriteCss, dispose() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); } });
}
