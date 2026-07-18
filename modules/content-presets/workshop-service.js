import { getTableData } from '../phone-core/data-api.js';
import { buildContentPresetCatalog } from './catalog.js';
import { importContentPreset, serializeContentPreset } from './import-export.js';
import { getContentPresetIndexSnapshot, subscribeContentPresetIndex } from './index-state.js';
import { invalidateContentPresetInstances } from './instance-coordinator.js';
import { enqueueContentPresetMutation } from './mutation-coordinator.js';
import { convergeCurrentContentPresetRoute } from './route-convergence.js';
import {
    clearActiveBinding,
    clearAllActiveBindings,
    deletePresetRecord,
    getPresetExportRecord,
    getPresetRecord,
    listPresetRecords,
    replacePresetRecord,
    setActiveBinding,
} from './repository.js';

function metadataOf(record) {
    return Object.freeze({
        id: record.id,
        name: record.name,
        version: record.version,
        author: record.author,
        itemCount: record.items?.length || 0,
        issues: record.issues || [],
        importedAt: record.importedAt,
    });
}

function withCommittedMutation(operation, buildPatch) {
    return enqueueContentPresetMutation(operation, (result, current) => buildPatch(result, current))
        .then(async (result) => {
            const affectedSheetKeys = result.affectedSheetKeys || [];
            invalidateContentPresetInstances(affectedSheetKeys);
            await convergeCurrentContentPresetRoute(affectedSheetKeys);
            return result;
        });
}

function replaceMetadata(current, record) {
    const metadata = new Map(current.metadata);
    metadata.set(record.id, metadataOf(record));
    return metadata;
}

export function createContentPresetWorkshopService(options = {}) {
    const readTableData = options.getTableData || getTableData;

    const getViewModel = async () => {
            const [presets, rawData] = await Promise.all([
                listPresetRecords(),
                Promise.resolve(readTableData()),
            ]);
            const index = getContentPresetIndexSnapshot();
            return Object.freeze({
                status: index.status,
                error: index.error,
                revision: index.revision,
                presets: Object.freeze(presets),
                tables: buildContentPresetCatalog(rawData || {}, presets, index.activeByTable),
            });
    };

    return Object.freeze({
        getSnapshot: getContentPresetIndexSnapshot,
        subscribe: subscribeContentPresetIndex,
        getViewModel,

        async prepareImport(input) {
            const record = importContentPreset(input);
            const existing = await getPresetRecord(record.id);
            return Object.freeze({ record, replacesExisting: !!existing });
        },

        async importPrepared(prepared, allowReplace = false) {
            const record = prepared?.record;
            if (!record?.id) throw new Error('待导入预设无效');
            return withCommittedMutation(async () => {
                const existing = await getPresetRecord(record.id);
                if (existing && !allowReplace) {
                    const error = new Error(`预设 ${record.id} 已存在，需要确认覆盖`);
                    error.code = 'CONTENT_PRESET_REPLACE_CONFIRMATION_REQUIRED';
                    throw error;
                }
                const result = await replacePresetRecord(record);
                return { ...result, replaced: !!existing };
            }, (result, current) => {
                const activeByTable = new Map(current.activeByTable);
                result.affectedSheetKeys.forEach(key => activeByTable.delete(key));
                return {
                    affectedSheetKeys: result.affectedSheetKeys,
                    indexPatch: { status: 'ready', error: null, metadata: replaceMetadata(current, record), activeByTable },
                };
            });
        },

        async exportPreset(presetId) {
            const record = await getPresetExportRecord(presetId);
            if (!record) throw new Error(`预设不存在：${presetId}`);
            return Object.freeze({
                filename: `${record.id}.yuzi-beautify.json`,
                text: serializeContentPreset(record),
                mimeType: 'application/json',
            });
        },

        async deletePreset(presetId) {
            return withCommittedMutation(
                () => deletePresetRecord(presetId),
                (result, current) => {
                    const metadata = new Map(current.metadata);
                    const activeByTable = new Map(current.activeByTable);
                    metadata.delete(result.presetId);
                    result.affectedSheetKeys.forEach(key => activeByTable.delete(key));
                    return {
                        affectedSheetKeys: result.affectedSheetKeys,
                        indexPatch: { metadata, activeByTable },
                    };
                },
            );
        },

        async setActive(sheetKey, presetId, itemId) {
            return withCommittedMutation(
                async () => {
                    const view = await getViewModel();
                    const table = view.tables.find(entry => entry.sheetKey === sheetKey);
                    const candidate = table?.candidates.find(entry => entry.presetId === presetId && entry.itemId === itemId);
                    if (!table || !candidate) throw new Error('目标表或预设项不可绑定');
                    return { record: await setActiveBinding(sheetKey, presetId, itemId), affectedSheetKeys: [sheetKey] };
                },
                (result, current) => {
                    const activeByTable = new Map(current.activeByTable);
                    activeByTable.set(sheetKey, result.record);
                    return { affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable } };
                },
            );
        },

        async clearActive(sheetKey) {
            return withCommittedMutation(
                async () => { await clearActiveBinding(sheetKey); return { affectedSheetKeys: [sheetKey] }; },
                (result, current) => {
                    const activeByTable = new Map(current.activeByTable);
                    activeByTable.delete(sheetKey);
                    return { affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable } };
                },
            );
        },

        async clearAllActive() {
            return withCommittedMutation(
                async () => { await clearAllActiveBindings(); return { affectedSheetKeys: [...getContentPresetIndexSnapshot().activeByTable.keys()] }; },
                (result) => ({ affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable: new Map() } }),
            );
        },
    });
}
