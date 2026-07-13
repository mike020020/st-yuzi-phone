import { restorePhoneBeautifyTemplatesToBuiltinDefaults } from '../../phone-beautify-templates/reset.js';
import { buildBeautifyTemplatePageHtml } from '../layout/frame.js';
import { showConfirmDialog } from '../ui/confirm-dialog.js';
import { showToast } from '../ui/toast.js';
import { createBeautifyPageBehavior } from './beautify-behavior.js';

export function createBeautifyTemplatePage(ctx) {
    return {
        mount() {
            renderBeautifyTemplatePage(ctx);
        },
        update() {
            renderBeautifyTemplatePage(ctx);
        },
        dispose() {},
    };
}

export function renderBeautifyTemplatePage(ctx) {
    const { container, pageRuntime, registerCleanup } = ctx;
    container.innerHTML = buildBeautifyTemplatePageHtml();

    const behavior = createBeautifyPageBehavior({
        container,
        ctx,
        runtime: pageRuntime,
    }, {
        restorePhoneBeautifyTemplatesToBuiltinDefaults,
        showConfirmDialog,
        showToast,
    });
    const cleanup = behavior.attachPageInteractions();
    if (pageRuntime?.registerCleanup) {
        pageRuntime.registerCleanup(cleanup);
    } else if (typeof registerCleanup === 'function') {
        registerCleanup(cleanup);
    }
}
