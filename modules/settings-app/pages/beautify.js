import { buildBeautifyTemplatePageHtml } from '../layout/frame.js';
import { downloadTextFile } from '../services/media-upload/download.js';
import { showConfirmDialog } from '../ui/confirm-dialog.js';
import { createBeautifyPageBehavior } from './beautify-behavior.js';

function loadingViewModel() {
    return Object.freeze({ status: 'loading', error: null, presets: [], tables: [] });
}

export function createBeautifyTemplatePage(ctx) {
    const { container, contentPresetWorkshopService, pageRuntime, showToast } = ctx;
    let viewModel = loadingViewModel();
    let disposed = false;
    let loadToken = 0;
    let detachInteractions = () => {};
    let unsubscribe = () => {};

    const render = () => {
        if (disposed) return;
        detachInteractions();
        container.innerHTML = buildBeautifyTemplatePageHtml(viewModel);
        const behavior = createBeautifyPageBehavior({
            container,
            runtime: pageRuntime,
            onChanged: refresh,
            onBack: () => {
                if (!ctx.state || typeof ctx.render !== 'function') return;
                ctx.state.mode = 'home';
                ctx.render();
            },
        }, {
            contentPresetWorkshopService,
            downloadTextFile,
            showConfirmDialog,
            showToast,
        });
        detachInteractions = behavior.attachPageInteractions();
    };

    const refresh = async () => {
        const token = ++loadToken;
        try {
            const next = await contentPresetWorkshopService.getViewModel();
            if (disposed || token !== loadToken) return;
            viewModel = next;
        } catch (error) {
            if (disposed || token !== loadToken) return;
            viewModel = Object.freeze({ status: 'error', error, presets: [], tables: [] });
        }
        render();
    };

    return {
        mount() {
            disposed = false;
            render();
            unsubscribe = contentPresetWorkshopService.subscribe(() => { void refresh(); });
            void refresh();
        },
        update() { render(); },
        dispose() {
            disposed = true;
            loadToken += 1;
            detachInteractions();
            unsubscribe();
        },
    };
}

export function renderBeautifyTemplatePage(ctx) {
    const page = createBeautifyTemplatePage(ctx);
    page.mount();
    ctx.pageRuntime?.registerCleanup?.(() => page.dispose());
}
