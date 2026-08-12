import { buildSettingsHomePageHtml } from '../layout/frame.js';

export function createHomePage(ctx) {
    return {
        mount() { renderHomePage(ctx); },
        update() { renderHomePage(ctx); },
        dispose() {},
    };
}

export function renderHomePage(ctx) {
    const {
        container,
        state,
        render,
        navigateBack,
        pageRuntime,
    } = ctx;
    container.innerHTML = buildSettingsHomePageHtml();

    const runtime = pageRuntime && typeof pageRuntime === 'object' ? pageRuntime : null;
    const bindEvent = (target, type, listener, options) => runtime?.addEventListener
        ? runtime.addEventListener(target, type, listener, options)
        : () => {};

    bindEvent(container.querySelector('.phone-nav-back'), 'click', navigateBack);
    container.querySelectorAll('.phone-settings-home-trigger').forEach((button) => {
        bindEvent(button, 'click', () => {
            const entry = String(button.dataset.entry || '').trim();
            if (!entry) return;
            state.mode = entry;
            render();
        });
    });

}
