export function normalizeMatchText(value) {
    return String(value ?? '').normalize('NFKC').trim();
}

export function normalizeFieldList(fields) {
    return Object.freeze((Array.isArray(fields) ? fields : [])
        .map(normalizeMatchText)
        .filter(Boolean));
}

export function matchesPresetItem(item, table) {
    const target = item?.target && typeof item.target === 'object' ? item.target : {};
    const expectedName = normalizeMatchText(target.tableName);
    const actualName = normalizeMatchText(table?.tableName);
    if (!expectedName || expectedName !== actualName) return false;

    const actualFields = new Set(normalizeFieldList(table?.headers));
    const expectedFields = normalizeFieldList(target.fields);
    return expectedFields.every(field => actualFields.has(field));
}

export function listMatchingItems(presets, table) {
    const matches = [];
    for (const preset of Array.isArray(presets) ? presets : []) {
        for (const item of Array.isArray(preset?.items) ? preset.items : []) {
            if (item.activatable && matchesPresetItem(item, table)) {
                matches.push(Object.freeze({ presetId: preset.id, itemId: item.id, preset, item }));
            }
        }
    }
    return Object.freeze(matches);
}
