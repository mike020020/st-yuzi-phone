import { getTableData } from '../phone-core/data-api.js';
import {
    buildPhoneBackButton,
    buildPhoneNavBar,
    buildPhoneNavTitleSwitcher,
    buildPhoneSwitchButton,
} from '../phone-core/navigation-ui.js';
import { navigateBack, navigateTo } from '../phone-core/routing.js';
import { buildTableNavigationControlState, requestTableNavigationSwitch } from '../table-navigation/controls.js';
import { escapeHtmlAttr } from '../utils/dom-escape.js';

export function renderContentPresetShell(page, snapshot) {
    const navigation = buildTableNavigationControlState(getTableData(), snapshot.sheetKey);
    const navigationHtml = buildPhoneNavBar({
        leadingHtml: buildPhoneBackButton({ attributes: { 'data-yb-action': 'back' } }),
        centerHtml: buildPhoneNavTitleSwitcher({
            className: 'phone-content-preset-title-nav',
            title: snapshot.tableName,
            previousHtml: buildPhoneSwitchButton('previous', {
                attributes: { 'data-yb-action': 'previous' },
                disabled: navigation.previous.disabled,
                label: '上一张表',
            }),
            nextHtml: buildPhoneSwitchButton('next', {
                attributes: { 'data-yb-action': 'next' },
                disabled: navigation.next.disabled,
                label: '下一张表',
            }),
        }),
        trailingHtml: `<button type="button" class="phone-nav-action" data-yb-action="edit" data-sheet-key="${escapeHtmlAttr(snapshot.sheetKey)}">编辑</button>`,
    });
    page.innerHTML = `<div class="phone-app-page phone-content-preset-shell">
        ${navigationHtml}
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
