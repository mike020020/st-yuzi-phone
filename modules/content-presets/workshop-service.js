import { getTableData } from '../phone-core/data-api.js';
import { isContentPresetFullPageRuntimeEnabled } from './activation-gate.js';
import { buildContentPresetCatalog } from './catalog.js';
import { importContentPreset, serializeContentPreset } from './import-export.js';
import { getContentPresetIndexSnapshot, subscribeContentPresetIndex } from './index-state.js';
import { invalidateContentPresetInstances } from './instance-coordinator.js';
import { enqueueContentPresetMutation } from './mutation-coordinator.js';
import { convergeCurrentContentPresetRoute } from './route-convergence.js';
import { contentPresetScrollRegistry } from './scroll-registry.js';
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

const DEFAULT_WORKSHOP_DEPS = Object.freeze({
    buildContentPresetCatalog,
    clearActiveBinding,
    clearAllActiveBindings,
    contentPresetScrollRegistry,
    convergeCurrentContentPresetRoute,
    deletePresetRecord,
    enqueueContentPresetMutation,
    getContentPresetIndexSnapshot,
    getPresetExportRecord,
    getPresetRecord,
    importContentPreset,
    invalidateContentPresetInstances,
    isContentPresetFullPageRuntimeEnabled,
    listPresetRecords,
    replacePresetRecord,
    serializeContentPreset,
    setActiveBinding,
    subscribeContentPresetIndex,
});

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

async function capturePostCommitFailure(task) {
    try {
        await task();
    } catch {}
}

function withCommittedMutation(runtimeDeps, operation, buildPatch, afterCommit) {
    return runtimeDeps.enqueueContentPresetMutation(
        operation,
        (result, current) => buildPatch(result, current),
        (result, current, patch) => capturePostCommitFailure(
            () => afterCommit?.(result, current, patch),
        ),
    )
        .then(async (result) => {
            const affectedSheetKeys = result.affectedSheetKeys || [];
            await capturePostCommitFailure(() => runtimeDeps.invalidateContentPresetInstances(affectedSheetKeys));
            await capturePostCommitFailure(() => runtimeDeps.convergeCurrentContentPresetRoute(affectedSheetKeys));
            return result;
        });
}

function replaceMetadata(current, record) {
    const metadata = new Map(current.metadata);
    metadata.set(record.id, metadataOf(record));
    return metadata;
}

export function createUnavailableContentPresetWorkshopService() {
    const error = new Error('模板工坊将在完整页面运行时启用后可用');
    const snapshot = Object.freeze({ status: 'unavailable', error, metadata: new Map(), activeByTable: new Map(), revision: 0 });
    const viewModel = Object.freeze({ status: 'unavailable', error, revision: 0, presets: Object.freeze([]), tables: Object.freeze([]) });
    const unavailable = () => Promise.reject(error);
    return Object.freeze({
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        getViewModel: async () => viewModel,
        prepareImport: unavailable,
        importPrepared: unavailable,
        exportPreset: unavailable,
        deletePreset: unavailable,
        setActive: unavailable,
        clearActive: unavailable,
        clearAllActive: unavailable,
    });
}

function createContentPresetWorkshopServiceWithDeps(options = {}, overrides = {}) {
    const runtimeDeps = { ...DEFAULT_WORKSHOP_DEPS, ...overrides };
    if (!runtimeDeps.isContentPresetFullPageRuntimeEnabled()) return createUnavailableContentPresetWorkshopService();
    const readTableData = options.getTableData || getTableData;

    const getViewModel = async () => {
            const [presets, rawData] = await Promise.all([
                runtimeDeps.listPresetRecords(),
                Promise.resolve(readTableData()),
            ]);
            const index = runtimeDeps.getContentPresetIndexSnapshot();
            return Object.freeze({
                status: index.status,
                error: index.error,
                revision: index.revision,
                presets: Object.freeze(presets),
                tables: runtimeDeps.buildContentPresetCatalog(rawData || {}, presets, index.activeByTable),
            });
    };

    return Object.freeze({
        getSnapshot: runtimeDeps.getContentPresetIndexSnapshot,
        subscribe: runtimeDeps.subscribeContentPresetIndex,
        getViewModel,

        async prepareImport(input) {
            const record = runtimeDeps.importContentPreset(input);
            const existing = await runtimeDeps.getPresetRecord(record.id);
            return Object.freeze({ record, replacesExisting: !!existing });
        },

        async importPrepared(prepared, allowReplace = false) {
            const record = prepared?.record;
            if (!record?.id) throw new Error('待导入预设无效');
            return withCommittedMutation(runtimeDeps, async () => {
                const existing = await runtimeDeps.getPresetRecord(record.id);
                if (existing && !allowReplace) {
                    const error = new Error(`预设 ${record.id} 已存在，需要确认覆盖`);
                    error.code = 'CONTENT_PRESET_REPLACE_CONFIRMATION_REQUIRED';
                    throw error;
                }
                const result = await runtimeDeps.replacePresetRecord(record);
                return { ...result, replaced: !!existing };
            }, (result, current) => {
                const activeByTable = new Map(current.activeByTable);
                result.affectedSheetKeys.forEach(key => activeByTable.delete(key));
                return {
                    affectedSheetKeys: result.affectedSheetKeys,
                    indexPatch: { status: 'ready', error: null, metadata: replaceMetadata(current, record), activeByTable },
                };
            }, (result) => {
                if (result.replaced) runtimeDeps.contentPresetScrollRegistry.clearByPreset(record.id);
            });
        },

        async exportPreset(presetId) {
            const record = await runtimeDeps.getPresetExportRecord(presetId);
            if (!record) throw new Error(`预设不存在：${presetId}`);
            return Object.freeze({
                filename: `${record.id}.yuzi-beautify.json`,
                text: runtimeDeps.serializeContentPreset(record),
                mimeType: 'application/json',
            });
        },

        async deletePreset(presetId) {
            return withCommittedMutation(runtimeDeps,
                () => runtimeDeps.deletePresetRecord(presetId),
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
                result => runtimeDeps.contentPresetScrollRegistry.clearByPreset(result.presetId),
            );
        },

        async setActive(sheetKey, presetId, itemId) {
            return withCommittedMutation(runtimeDeps,
                async () => {
                    const view = await getViewModel();
                    const table = view.tables.find(entry => entry.sheetKey === sheetKey);
                    const candidate = table?.candidates.find(entry => entry.presetId === presetId && entry.itemId === itemId);
                    if (!table || !candidate) throw new Error('目标表或预设项不可绑定');
                    return { record: await runtimeDeps.setActiveBinding(sheetKey, presetId, itemId), affectedSheetKeys: [sheetKey] };
                },
                (result, current) => {
                    const activeByTable = new Map(current.activeByTable);
                    activeByTable.set(sheetKey, result.record);
                    return { affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable } };
                },
                (_result, current) => {
                    const previous = current.activeByTable.get(sheetKey);
                    if (previous) runtimeDeps.contentPresetScrollRegistry.clearByBinding(previous);
                },
            );
        },

        async clearActive(sheetKey) {
            return withCommittedMutation(runtimeDeps,
                async () => { await runtimeDeps.clearActiveBinding(sheetKey); return { affectedSheetKeys: [sheetKey] }; },
                (result, current) => {
                    const activeByTable = new Map(current.activeByTable);
                    activeByTable.delete(sheetKey);
                    return { affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable } };
                },
                (_result, current) => {
                    const previous = current.activeByTable.get(sheetKey);
                    if (previous) runtimeDeps.contentPresetScrollRegistry.clearByBinding(previous);
                },
            );
        },

        async clearAllActive() {
            return withCommittedMutation(runtimeDeps,
                async () => { await runtimeDeps.clearAllActiveBindings(); return { affectedSheetKeys: [...runtimeDeps.getContentPresetIndexSnapshot().activeByTable.keys()] }; },
                (result) => ({ affectedSheetKeys: result.affectedSheetKeys, indexPatch: { activeByTable: new Map() } }),
                (_result, current) => {
                    for (const binding of current.activeByTable.values()) runtimeDeps.contentPresetScrollRegistry.clearByBinding(binding);
                },
            );
        },
    });
}

export function createContentPresetWorkshopService(options = {}) {
    return createContentPresetWorkshopServiceWithDeps(options);
}

export function __test__createContentPresetWorkshopService(overrides = {}, options = {}) {
    return createContentPresetWorkshopServiceWithDeps(options, overrides);
}
