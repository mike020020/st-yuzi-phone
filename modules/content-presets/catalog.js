import { buildTableNavigationCatalog } from '../table-navigation/catalog.js';
import { createTableSnapshot } from './snapshot.js';
import { listMatchingItems } from './matcher.js';

export function buildContentPresetCatalog(rawData, presets = [], activeByTable = new Map()) {
    return Object.freeze(buildTableNavigationCatalog(rawData)
        .map((entry) => {
            const snapshot = createTableSnapshot(rawData, entry.sheetKey);
            const table = { tableName: snapshot?.tableName || entry.tableName, headers: snapshot?.rawHeaders || [] };
            return Object.freeze({
                ...entry,
                headers: Object.freeze([...(snapshot?.rawHeaders || [])]),
                candidates: listMatchingItems(presets, table),
                active: activeByTable.get(entry.sheetKey) || null,
            });
        }));
}
