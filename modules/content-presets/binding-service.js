import { getContentPresetIndexSnapshot } from './index-state.js';
import { matchesPresetItem } from './matcher.js';

export function resolveActiveContentPreset({ sheetKey, preset, snapshot }) {
    if (!sheetKey) return null;
    const binding = getContentPresetIndexSnapshot().activeByTable.get(sheetKey);
    if (!binding || binding.presetId !== preset?.id) return null;
    const item = preset.items?.find(entry => entry.id === binding.itemId);
    if (!item?.activatable || !matchesPresetItem(item, snapshot)) return null;
    return Object.freeze({ binding, preset, item });
}

export function isBindingAllowed(_catalogEntry, preset, item, snapshot) {
    return !!item?.activatable
        && preset?.items?.includes(item)
        && matchesPresetItem(item, snapshot);
}
