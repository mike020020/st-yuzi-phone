import {
    clearPhoneTemporaryLayers,
    getPhoneTemporaryLayerHost,
    mountPhoneTemporaryLayer,
} from '../../../phone-core/shell-temporary-layer-host.js';
import { escapeHtml, escapeHtmlAttr } from '../../../utils/dom-escape.js';

let dialogSequence = 0;

function mountIconDialog(overlay, runtime = null) {
    if (!getPhoneTemporaryLayerHost()) return null;
    clearPhoneTemporaryLayers();

    const cleanups = [];
    let closed = false;
    let disposeLayer = () => {};

    const bind = (target, type, listener, options) => {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
    };
    const cleanup = () => {
        const tasks = cleanups.splice(0).reverse();
        tasks.forEach(task => task());
    };
    const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        disposeLayer();
    };

    disposeLayer = mountPhoneTemporaryLayer(overlay, () => {
        if (closed) return;
        closed = true;
        cleanup();
    });
    bind(overlay, 'click', (event) => {
        if (event.target === overlay) close();
    });
    bind(document, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
    });
    runtime?.registerCleanup?.(close);

    requestAnimationFrame(() => {
        if (closed) return;
        overlay.classList.add('is-visible');
        overlay.querySelector('button')?.focus?.();
    });

    return { bind, close };
}

export function showAppearanceIconSourceMenu({ packName, onLocalUpload, onPackSelect, runtime = null } = {}) {
    const titleId = `phone-appearance-icon-source-title-${++dialogSequence}`;
    const overlay = document.createElement('div');
    overlay.className = 'phone-appearance-icon-dialog-layer';
    overlay.innerHTML = `
        <section class="phone-appearance-icon-dialog phone-appearance-icon-source-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
            <header class="phone-appearance-icon-dialog-header">
                <div>
                    <h2 id="${titleId}">选择图标来源</h2>
                    <p>${escapeHtml(packName || '当前美化包')}</p>
                </div>
                <button type="button" class="phone-appearance-icon-dialog-close" aria-label="关闭">×</button>
            </header>
            <div class="phone-appearance-icon-source-actions">
                <button type="button" class="phone-appearance-icon-source-action" data-icon-source="local">
                    <span>从本地上传</span>
                    <small>继续使用现有选图与裁剪</small>
                </button>
                <button type="button" class="phone-appearance-icon-source-action" data-icon-source="pack">
                    <span>从当前美化包选择</span>
                    <small>${escapeHtml(packName || '当前美化包')}</small>
                </button>
            </div>
        </section>
    `;

    const dialog = mountIconDialog(overlay, runtime);
    if (!dialog) return null;
    dialog.bind(overlay.querySelector('.phone-appearance-icon-dialog-close'), 'click', dialog.close);
    dialog.bind(overlay.querySelector('[data-icon-source="local"]'), 'click', () => {
        dialog.close();
        onLocalUpload?.();
    });
    dialog.bind(overlay.querySelector('[data-icon-source="pack"]'), 'click', () => {
        dialog.close();
        onPackSelect?.();
    });
    return dialog.close;
}

export function showAppearancePackIconPicker({ packName, icons, onSelect, runtime = null } = {}) {
    const items = Array.isArray(icons) ? icons.filter(icon => icon?.dataUrl) : [];
    if (items.length === 0) return null;

    const titleId = `phone-appearance-pack-icon-title-${++dialogSequence}`;
    const overlay = document.createElement('div');
    overlay.className = 'phone-appearance-icon-dialog-layer';
    overlay.innerHTML = `
        <section class="phone-appearance-icon-dialog phone-appearance-pack-icon-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
            <header class="phone-appearance-icon-dialog-header">
                <div>
                    <h2 id="${titleId}">选择图标</h2>
                    <p>${escapeHtml(packName || '当前美化包')}</p>
                </div>
                <button type="button" class="phone-appearance-icon-dialog-close" aria-label="关闭">×</button>
            </header>
            <div class="phone-appearance-pack-icon-grid" role="listbox" aria-label="美化包图标">
                ${items.map((icon, index) => `
                    <button type="button" class="phone-appearance-pack-icon-option" role="option" data-pack-icon-index="${index}" aria-label="使用 ${escapeHtmlAttr(icon.name)}">
                        <img src="${escapeHtmlAttr(icon.dataUrl)}" alt="">
                        <span>${escapeHtml(icon.name)}</span>
                    </button>
                `).join('')}
            </div>
        </section>
    `;

    const dialog = mountIconDialog(overlay, runtime);
    if (!dialog) return null;
    dialog.bind(overlay.querySelector('.phone-appearance-icon-dialog-close'), 'click', dialog.close);
    overlay.querySelectorAll('[data-pack-icon-index]').forEach((button) => {
        dialog.bind(button, 'click', () => {
            const index = Number(button.getAttribute('data-pack-icon-index'));
            const icon = items[index];
            if (!icon) return;
            dialog.close();
            onSelect?.(icon);
        });
    });
    return dialog.close;
}
