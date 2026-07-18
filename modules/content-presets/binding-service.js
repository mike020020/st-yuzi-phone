import { getContentPresetIndexSnapshot } from './index-state.js';
import { isMessageCatalogEntry } from './catalog.js';
import { matchesPresetItem } from './matcher.js';

export function resolveActiveContentPreset({ sheetKey, catalogEntry, preset, snapshot }) {
    if (!sheetKey || isMessageCatalogEntry(catalogEntry)) return null;
    const binding = getContentPresetIndexSnapshot().activeByTable.get(sheetKey);
    if (!binding || binding.presetId !== preset?.id) return null;
    const item = preset.items?.find(entry => entry.id === binding.itemId);
    if (!item?.activatable || !matchesPresetItem(item, snapshot)) return null;
    return Object.freeze({ binding, preset, item });
}

export function isBindingAllowed(catalogEntry, preset, item, snapshot) {
    return !isMessageCatalogEntry(catalogEntry)
        && !!item?.activatable
        && preset?.items?.includes(item)
        && matchesPresetItem(item, snapshot);
}
