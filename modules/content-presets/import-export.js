import { CONTENT_PRESET_FORMAT, CONTENT_PRESET_FORMAT_VERSION } from './constants.js';
import { parseContentPresetBundle } from './format.js';
import { normalizeContentPresetBundle } from './normalize.js';

export function importContentPreset(input) {
    return normalizeContentPresetBundle(parseContentPresetBundle(input));
}

function sortedObject(value) {
    return Object.fromEntries(Object.keys(value || {}).sort().map(key => [key, value[key]]));
}

export function exportContentPreset(record) {
    const manifest = {
        ...record.manifest,
        id: record.id,
        name: record.name,
        version: record.version,
        author: record.author,
        items: record.items.map(item => ({
            id: item.id, name: item.name, target: item.target,
            entry: item.entry, assets: item.assets,
        })),
    };
    return {
        format: CONTENT_PRESET_FORMAT,
        formatVersion: CONTENT_PRESET_FORMAT_VERSION,
        manifest,
        files: sortedObject(record.files),
    };
}

export function serializeContentPreset(record) {
    return `${JSON.stringify(exportContentPreset(record), null, 2)}\n`;
}

export function readbackContentPreset(record) {
    const serialized = serializeContentPreset(record);
    const restored = importContentPreset(serialized);
    if (restored.id !== record.id || restored.items.length !== record.items.length) {
        throw new Error('玉子美化预设回读不一致');
    }
    return Object.freeze({ serialized, record: restored });
}
