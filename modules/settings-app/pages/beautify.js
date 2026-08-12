import { buildBeautifyTemplatePageHtml } from '../layout/frame.js';
import { downloadTextFile } from '../services/media-upload/download.js';
import { showConfirmDialog } from '../ui/confirm-dialog.js';
import { createScrollPreserver } from '../ui/settings-scroll-binding.js';
import { createBeautifyPageBehavior } from './beautify-behavior.js';

function loadingViewModel() {
    return Object.freeze({ status: 'loading', error: null, presets: [], tables: [] });
}

export function createBeautifyTemplatePage(ctx) {
    const { container, contentPresetWorkshopService, pageRuntime, showToast } = ctx;
    const { createRerenderWithScroll } = createScrollPreserver(container, ctx.state || {}, undefined, pageRuntime);
    let viewModel = loadingViewModel();
    let disposed = false;
    let detachInteractions = () => {};
    let unsubscribe = () => {};
    let requestedRevision = -1;
    let renderedRevision = -1;
    let refreshPromise = null;
    let refreshFailure = null;

    const render = () => {
        if (disposed) return;
        detachInteractions();
        container.innerHTML = buildBeautifyTemplatePageHtml(viewModel);
        const behavior = createBeautifyPageBehavior({
            container,
            runtime: pageRuntime,
            waitForCommittedRefresh,
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
    const renderKeepScroll = createRerenderWithScroll('beautifyScrollTop', render);

    function requestRefresh(revision = contentPresetWorkshopService.getSnapshot?.().revision ?? 0) {
        requestedRevision = Math.max(requestedRevision, Number(revision) || 0);
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
            while (!disposed && renderedRevision < requestedRevision) {
                const targetRevision = requestedRevision;
                let nextViewModel;
                try {
                    nextViewModel = await contentPresetWorkshopService.getViewModel();
                    refreshFailure = null;
                } catch (error) {
                    nextViewModel = Object.freeze({ status: 'error', error, revision: targetRevision, presets: [], tables: [] });
                    refreshFailure = { revision: targetRevision, error };
                }
                if (disposed) return;
                const resolvedRevision = Math.max(targetRevision, Number(nextViewModel.revision) || 0);
                if (resolvedRevision < requestedRevision) continue;
                viewModel = nextViewModel;
                renderedRevision = resolvedRevision;
                renderKeepScroll();
            }
        })().finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    async function waitForCommittedRefresh() {
        const revision = contentPresetWorkshopService.getSnapshot?.().revision ?? renderedRevision;
        if (renderedRevision < revision) await requestRefresh(revision);
        if (refreshFailure && refreshFailure.revision >= revision) {
            const error = new Error(`操作已提交，但模板工坊刷新失败：${refreshFailure.error?.message || '读取最新状态失败'}`);
            error.code = 'CONTENT_PRESET_WORKSHOP_REFRESH_FAILED_AFTER_COMMIT';
            error.cause = refreshFailure.error;
            throw error;
        }
    }

    return {
        mount() {
            disposed = false;
            render();
            unsubscribe = contentPresetWorkshopService.subscribe(snapshot => { void requestRefresh(snapshot?.revision); });
            void requestRefresh(contentPresetWorkshopService.getSnapshot?.().revision ?? 0);
        },
        update() { render(); },
        dispose() {
            disposed = true;
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
