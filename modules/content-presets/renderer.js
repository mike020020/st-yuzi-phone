import { acquireCurrentViewingSheet, releaseCurrentViewingSheet } from '../phone-core/callbacks.js';
import { getTableData } from '../phone-core/data-api.js';
import { registerRoutePageCleanup } from '../phone-core/route-page-lifecycle.js';
import { getPhoneCoreState } from '../phone-core/state.js';
import { createAssetRuntime } from './asset-runtime.js';
import { getContentPresetIndexSnapshot } from './index-state.js';
import { createContentPresetInstance } from './instance-coordinator.js';
import { matchesPresetItem } from './matcher.js';
import { getPresetRecord } from './repository.js';
import { createContentPresetRuntimeContext, registerContentPresetContext } from './runtime-context.js';
import { executeContentPresetScript } from './script-runtime.js';
import { renderContentPresetShell } from './shell.js';
import { createTableSnapshot } from './snapshot.js';

function fileText(record, path) {
    const file = path ? record.files?.[path] : null;
    if (!file) return '';
    if (file.encoding !== 'base64') return String(file.content ?? '');
    const binary = atob(file.content);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function isActiveToken(renderToken) {
    return !Number.isFinite(renderToken) || getPhoneCoreState().routeRenderToken === renderToken;
}

export async function tryRenderContentPreset(page, target, options = {}) {
    const index = getContentPresetIndexSnapshot();
    const binding = index.status === 'ready' ? index.activeByTable.get(target.sheetKey) : null;
    if (!binding || target.catalogEntry?.specialType === 'message') return false;

    let snapshot;
    try {
        snapshot = createTableSnapshot(getTableData(), target.sheetKey);
    } catch {
        return false;
    }
    if (!snapshot) return false;

    let shell = null;
    let owner = null;
    let assetRuntime = null;
    let contextCleanup = null;
    let scriptResult = null;
    const scriptAbortController = new AbortController();
    let removeUpdateListener = null;
    let unregisterPageCleanup = null;
    let fallbackStarted = false;
    let instance = null;

    const disposeManagedResources = () => {
        scriptAbortController.abort();
        unregisterPageCleanup?.();
        unregisterPageCleanup = null;
        removeUpdateListener?.();
        removeUpdateListener = null;
        shell?.dispose();
        releaseCurrentViewingSheet(owner);
        contextCleanup?.();
        contextCleanup = null;
        scriptResult?.script?.remove();
        if (scriptResult?.url) URL.revokeObjectURL(scriptResult.url);
        scriptResult = null;
        assetRuntime?.dispose();
        assetRuntime = null;
    };

    const fallback = () => {
        if (fallbackStarted) return;
        fallbackStarted = true;
        const mayRenderFallback = isActiveToken(options.renderToken)
            && (!instance || instance.isCurrent(getPhoneCoreState().routeRenderToken));
        if (instance) instance.dispose();
        else disposeManagedResources();
        if (mayRenderFallback) options.originalRenderer?.(page);
    };

    try {
        shell = renderContentPresetShell(page, snapshot);
        owner = acquireCurrentViewingSheet(target.sheetKey);
        instance = createContentPresetInstance(target.sheetKey, options.renderToken, disposeManagedResources);
        unregisterPageCleanup = registerRoutePageCleanup(page, () => instance.dispose());

        const record = await getPresetRecord(binding.presetId);
        const item = record?.items?.find(entry => entry.id === binding.itemId);
        if (!item?.activatable || !matchesPresetItem(item, { tableName: snapshot.tableName, headers: snapshot.rawHeaders })) {
            throw new Error('绑定项已失效');
        }
        if (!instance.isCurrent(getPhoneCoreState().routeRenderToken)) {
            instance.dispose();
            return true;
        }

        assetRuntime = createAssetRuntime(record);
        const context = createContentPresetRuntimeContext({
            container: shell.body,
            snapshot,
            route: target.route,
            token: instance.token,
            resolveAsset: assetRuntime.resolveAsset,
        });
        contextCleanup = registerContentPresetContext(context);

        const handleTableUpdate = () => {
            if (!instance.isCurrent(getPhoneCoreState().routeRenderToken)) {
                instance.dispose();
                return;
            }
            try {
                const nextSnapshot = createTableSnapshot(getTableData(), target.sheetKey);
                if (!nextSnapshot || !matchesPresetItem(item, { tableName: nextSnapshot.tableName, headers: nextSnapshot.rawHeaders })) {
                    fallback();
                    return;
                }
                context.replaceSnapshot(nextSnapshot);
            } catch {
                fallback();
            }
        };
        const updateListener = (event) => {
            if (event?.detail?.sheetKey !== target.sheetKey) return;
            handleTableUpdate();
        };
        window.addEventListener('yuzi-phone-table-updated', updateListener);
        removeUpdateListener = () => window.removeEventListener('yuzi-phone-table-updated', updateListener);

        const html = fileText(record, item.entry.html);
        const css = fileText(record, item.entry.css);
        shell.body.innerHTML = html ? assetRuntime.rewriteHtml(html, item.entry.html) : '';
        if (css) {
            const style = document.createElement('style');
            style.textContent = assetRuntime.rewriteCss(css, item.entry.css);
            shell.body.prepend(style);
        }
        if (item.entry.js) {
            scriptResult = await executeContentPresetScript({
                mode: item.entry.scriptMode,
                source: fileText(record, item.entry.js),
                signal: scriptAbortController.signal,
            });
        }
        if (!instance.isCurrent(getPhoneCoreState().routeRenderToken)) instance.dispose();
        return true;
    } catch {
        fallback();
        return true;
    }
}
