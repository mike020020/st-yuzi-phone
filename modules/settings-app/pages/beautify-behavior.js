export function createBeautifyPageBehavior(params = {}, deps = {}) {
    const { container, runtime, onChanged, onBack } = params;
    const { contentPresetWorkshopService: service, downloadTextFile, showConfirmDialog, showToast } = deps;
    let busy = false;
    const isDisposed = () => runtime?.isDisposed?.() === true;
    const notify = (message, isError = false) => showToast?.(container, message, isError, runtime);

    const run = async (button, operation, successMessage) => {
        if (busy || isDisposed()) return;
        busy = true;
        if (button) button.disabled = true;
        try {
            await operation();
            if (isDisposed()) return;
            notify(successMessage);
            await onChanged?.();
        } catch (error) {
            if (!isDisposed()) notify(error?.message || '操作失败', true);
        } finally {
            busy = false;
            if (button?.isConnected) button.disabled = false;
        }
    };

    const confirm = (title, message, confirmText, operation) => {
        showConfirmDialog?.(container, title, message, operation, confirmText, '取消', runtime);
    };

    const importFile = async (button) => {
        if (busy || isDisposed()) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file || isDisposed()) return;
            try {
                const prepared = await service.prepareImport(await file.text());
                if (isDisposed()) return;
                const commit = () => run(button, () => service.importPrepared(prepared, prepared.replacesExisting), prepared.replacesExisting ? '预设已原子覆盖，旧绑定已清除' : '预设已导入');
                if (prepared.replacesExisting) {
                    confirm('覆盖同 ID 预设？', `预设 ${prepared.record.id} 已存在。覆盖会在同一事务中清除所有引用它的表绑定，且不会迁移同 itemId 绑定。`, '确认覆盖', commit);
                } else {
                    await commit();
                }
            } catch (error) {
                if (!isDisposed()) notify(`导入失败：${error?.message || '文件无效'}`, true);
            }
        }, { once: true });
        input.click();
    };

    const handleAction = (button) => {
        const action = button.dataset.action;
        const { presetId, itemId, sheetKey } = button.dataset;
        if (action === 'import') return void importFile(button);
        if (action === 'export') return void run(button, async () => {
            const result = await service.exportPreset(presetId);
            downloadTextFile(result.filename, result.text, result.mimeType);
        }, '预设已导出');
        if (action === 'delete') return confirm('删除完整预设？', `将删除预设 ${presetId}，并原子清除所有引用它的表绑定。`, '确认删除', () => run(button, () => service.deletePreset(presetId), '预设已删除'));
        if (action === 'activate') return void run(button, () => service.setActive(sheetKey, presetId, itemId), '已设为当前美化');
        if (action === 'clear') return void run(button, () => service.clearActive(sheetKey), '该表已恢复默认展示');
        if (action === 'clear-all') return confirm('全局恢复默认？', '将清除全部表级玉子美化绑定，但保留已导入预设。', '确认清除', () => run(button, () => service.clearAllActive(), '全部表已恢复默认展示'));
    };

    const attachPageInteractions = () => {
        const handleClick = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.phone-nav-back')) {
                onBack?.();
                return;
            }
            const button = target.closest('[data-action]');
            if (button instanceof HTMLButtonElement) handleAction(button);
        };
        container?.addEventListener?.('click', handleClick);
        return () => container?.removeEventListener?.('click', handleClick);
    };

    return { attachPageInteractions };
}
