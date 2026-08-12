import { PHONE_ICONS } from '../phone-home/icons.js';

export function buildPhoneShellHtml() {
    return `
        <div class="phone-shell">
            <div class="phone-notch" aria-hidden="true"></div>
            <div class="phone-status-bar">
                <span class="phone-status-time"></span>
                <span class="phone-status-icons">
                    <span class="phone-signal">${PHONE_ICONS.signal}</span>
                    <span class="phone-wifi">${PHONE_ICONS.wifi || ''}</span>
                    <span class="phone-battery">${PHONE_ICONS.battery}</span>
                </span>
            </div>
            <div class="phone-screen"></div>
            <div class="phone-temporary-layer-host" data-phone-temporary-layer-host></div>
            <button class="phone-home-indicator" data-phone-home-indicator type="button" aria-label="返回手机主页" hidden>
                <span aria-hidden="true"></span>
            </button>
        </div>
        <div class="yuzi-phone-resize yuzi-phone-resize-e" data-dir="e"></div>
        <div class="yuzi-phone-resize yuzi-phone-resize-se" data-dir="se"></div>
    `;
}

export function updatePhoneStatusBarTime(root = document) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const scope = root && typeof root.querySelector === 'function' ? root : document;
    const el = scope.querySelector('.phone-status-time') || document.querySelector('.phone-status-time');
    if (el) el.textContent = `${hh}:${mm}`;
}
