import { getTableData } from '../phone-core/data-api.js';
import { navigateBack, navigateTo } from '../phone-core/routing.js';
import { buildTableNavigationControlState, requestTableNavigationSwitch } from '../table-navigation/controls.js';
import { escapeHtml, escapeHtmlAttr } from '../utils/dom-escape.js';

export function renderContentPresetShell(page, snapshot) {
    const navigation = buildTableNavigationControlState(getTableData(), snapshot.sheetKey);
    page.innerHTML = `<div class="phone-app-page phone-content-preset-shell">
        <div class="phone-nav-bar">
            <button type="button" class="phone-nav-back" data-yb-action="back"><span>返回</span></button>
            <div class="phone-content-preset-title-nav">
                <button type="button" data-yb-action="previous" ${navigation.previous.disabled ? 'disabled' : ''}>‹</button>
                <span class="phone-nav-title">${escapeHtml(snapshot.tableName)}</span>
                <button type="button" data-yb-action="next" ${navigation.next.disabled ? 'disabled' : ''}>›</button>
            </div>
            <button type="button" class="phone-nav-action" data-yb-action="edit" data-sheet-key="${escapeHtmlAttr(snapshot.sheetKey)}">编辑</button>
        </div>
        <div class="phone-app-body phone-content-preset-body"><div class="phone-settings-note">正在加载玉子美化…</div></div>
    </div>`;
    const body = page.querySelector('.phone-content-preset-body');
    const listener = (event) => {
        const action = event.target?.closest?.('[data-yb-action]')?.dataset?.ybAction;
        if (action === 'back') navigateBack();
        if (action === 'edit') navigateTo(`table-generic:${snapshot.sheetKey}`);
        if (action === 'previous' || action === 'next') requestTableNavigationSwitch(snapshot.sheetKey, action);
    };
    page.addEventListener('click', listener);
    return Object.freeze({ body, dispose: () => page.removeEventListener('click', listener) });
}
