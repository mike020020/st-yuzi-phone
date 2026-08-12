function normalizePart(value) {
    return String(value || '').trim();
}

function keyOf(parts = {}) {
    const values = [parts.chatId, parts.sheetKey, parts.presetId, parts.itemId].map(normalizePart);
    return values.every(Boolean) ? JSON.stringify(values) : '';
}

export function createContentPresetScrollRegistry(options = {}) {
    const maxEntries = Math.max(1, Number(options.maxEntries) || 100);
    const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || (id => cancelAnimationFrame(id));
    const values = new Map();
    const touch = (key, value) => { values.delete(key); values.set(key, value); };
    const read = parts => { const key = keyOf(parts); if (!key || !values.has(key)) return null; const value = values.get(key); touch(key, value); return value; };
    const removeWhere = predicate => {
        let removed = 0;
        for (const [key, value] of values) {
            if (!predicate(value, key)) continue;
            values.delete(key);
            removed += 1;
        }
        return removed;
    };
    return Object.freeze({
        read,
        write(parts, scrollTop) {
            const key = keyOf(parts); if (!key) return false;
            touch(key, { ...parts, scrollTop: Math.max(0, Number(scrollTop) || 0) });
            while (values.size > maxEntries) values.delete(values.keys().next().value);
            return true;
        },
        remove(parts) { const key = keyOf(parts); return key ? values.delete(key) : false; },
        clearByPreset(presetId) {
            const normalizedPresetId = normalizePart(presetId);
            return normalizedPresetId ? removeWhere(value => normalizePart(value.presetId) === normalizedPresetId) : 0;
        },
        clearByBinding(parts = {}) {
            const sheetKey = normalizePart(parts.sheetKey);
            const presetId = normalizePart(parts.presetId);
            const itemId = normalizePart(parts.itemId);
            if (!sheetKey || !presetId || !itemId) return 0;
            return removeWhere(value => normalizePart(value.sheetKey) === sheetKey
                && normalizePart(value.presetId) === presetId && normalizePart(value.itemId) === itemId);
        },
        restore(root, parts, isCurrent = () => true, frames = 2) {
            const saved = read(parts); if (!saved || !root) return () => {};
            let cancelled = false; let frame = null; let remaining = Math.max(0, frames);
            const apply = () => {
                if (cancelled || !isCurrent()) return;
                const max = Math.max(0, Number(root.scrollHeight || 0) - Number(root.clientHeight || 0));
                root.scrollTop = Math.min(saved.scrollTop, max);
                if (remaining-- > 0) frame = requestFrame(apply);
            };
            frame = requestFrame(apply);
            return () => { cancelled = true; if (frame !== null) cancelFrame(frame); };
        },
        size: () => values.size,
        dispose() { values.clear(); },
    });
}

export const contentPresetScrollRegistry = createContentPresetScrollRegistry();
