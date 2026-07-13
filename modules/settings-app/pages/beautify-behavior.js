const RESTORE_BUTTON_ID = 'phone-beautify-restore-defaults-btn';

export function createBeautifyPageBehavior(params = {}, deps = {}) {
    const { container, ctx, runtime } = params;
    const { state, render } = ctx || {};
    const {
        restorePhoneBeautifyTemplatesToBuiltinDefaults,
        showConfirmDialog,
        showToast,
    } = deps;
    let isResetting = false;

    const isDisposed = () => runtime?.isDisposed?.() === true;
    const navigateBack = () => {
        if (!state || typeof render !== 'function') return;
        state.mode = 'home';
        render();
    };

    const runRestore = async (button) => {
        if (isResetting || isDisposed()) return;
        isResetting = true;
        if (button) button.disabled = true;
        try {
            const result = await Promise.resolve(restorePhoneBeautifyTemplatesToBuiltinDefaults?.());
            if (isDisposed()) return;
            if (result?.success) {
                showToast?.(container, '已恢复默认', false, runtime);
            } else {
                showToast?.(container, result?.message || '恢复默认失败，请重试', true, runtime);
            }
        } catch (error) {
            if (!isDisposed()) {
                showToast?.(container, `恢复默认失败：${error?.message || '未知错误'}`, true, runtime);
            }
        } finally {
            isResetting = false;
            if (button?.isConnected) button.disabled = false;
        }
    };

    const requestRestore = (button) => {
        if (isResetting || isDisposed()) return;
        showConfirmDialog?.(
            container,
            '永久删除历史模板并恢复默认？',
            '这会永久删除全部历史用户美化模板和表级模板绑定，并恢复内置默认。此操作不可撤销。',
            () => runRestore(button),
            '永久删除并恢复默认',
            '取消',
            runtime,
        );
    };

    const attachPageInteractions = () => {
        const handleClick = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.phone-nav-back')) {
                navigateBack();
                return;
            }
            const button = target.closest(`#${RESTORE_BUTTON_ID}`);
            if (button instanceof HTMLButtonElement) requestRestore(button);
        };

        if (runtime?.addEventListener) {
            return runtime.addEventListener(container, 'click', handleClick);
        }
        container?.addEventListener?.('click', handleClick);
        return () => container?.removeEventListener?.('click', handleClick);
    };

    return { attachPageInteractions };
}
