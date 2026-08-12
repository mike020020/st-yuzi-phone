import { escapeHtml, escapeHtmlAttr } from '../utils/dom-escape.js';
import {
    buildPhoneBackButton,
    buildPhoneNavBar,
    buildPhoneNavTitleSwitcher,
    buildPhoneSwitchButton,
} from '../phone-core/navigation-ui.js';

function buildDetailEditControlHtml(pair) {
    const fieldMetadata = pair.fieldMetadata;
    if (fieldMetadata?.type === 'enum' && Array.isArray(fieldMetadata.options) && fieldMetadata.options.length > 0) {
        const value = String(pair.value ?? '');
        const hasCurrentOption = value === '' || fieldMetadata.options.includes(value);
        return `
            <select class="phone-row-detail-input" data-input-col="${escapeHtmlAttr(String(pair.rawColIndex))}" data-input-control="select" ${pair.isLocked ? 'disabled' : ''}>
                <option value="">请选择${escapeHtml(pair.key)}</option>
                ${!hasCurrentOption ? `<option value="${escapeHtmlAttr(value)}" selected>${escapeHtml(`${value}（不在可选项中）`)}</option>` : ''}
                ${fieldMetadata.options.map((option) => `<option value="${escapeHtmlAttr(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
            </select>
        `;
    }

    return `<textarea class="phone-row-detail-input" data-input-col="${escapeHtmlAttr(String(pair.rawColIndex))}" data-input-control="textarea" ${pair.isLocked ? 'disabled' : ''}>${escapeHtml(pair.value)}</textarea>`;
}

export function buildGenericDetailPageHtml(options = {}) {
    const {
        title = '',
        kvPairs = [],
        rowLocked = false,
        pagerInfo = {},
        genericStylePayload,
        state,
    } = options;

    const pagerDisabled = !!pagerInfo.disabled;
    const prevIndex = Number.isInteger(pagerInfo.prevIndex) ? pagerInfo.prevIndex : -1;
    const nextIndex = Number.isInteger(pagerInfo.nextIndex) ? pagerInfo.nextIndex : -1;
    const navHtml = buildPhoneNavBar({
        className: 'phone-generic-slot-nav',
        leadingHtml: buildPhoneBackButton({ action: 'detail-back' }),
        centerHtml: buildPhoneNavTitleSwitcher({ title }),
    });
    const previousHtml = buildPhoneSwitchButton('previous', {
        className: 'phone-detail-pager-btn',
        label: '上一条',
        disabled: pagerDisabled,
        attributes: {
            'data-pager': 'prev',
            'data-target-row-index': String(prevIndex),
            'aria-disabled': pagerDisabled ? 'true' : 'false',
        },
    });
    const nextHtml = buildPhoneSwitchButton('next', {
        className: 'phone-detail-pager-btn',
        label: '下一条',
        disabled: pagerDisabled,
        attributes: {
            'data-pager': 'next',
            'data-target-row-index': String(nextIndex),
            'aria-disabled': pagerDisabled ? 'true' : 'false',
        },
    });

    return `
        <div class="phone-app-page phone-generic-root ${genericStylePayload.className}" data-generic-template-id="${escapeHtmlAttr(genericStylePayload.templateId)}" ${genericStylePayload.dataAttrs} style="${genericStylePayload.styleAttr}">
            ${genericStylePayload.scopedCss ? `<style class="phone-generic-template-inline-style">${genericStylePayload.scopedCss}</style>` : ''}
            ${navHtml}
            <div class="phone-app-body phone-table-body phone-generic-slot-body">
                <div class="phone-generic-detail-page phone-generic-detail-page-flow">
                    <div class="phone-row-detail-card phone-generic-slot-detail phone-generic-detail-flow-list">
                        ${kvPairs.map((pair) => `
                            <div class="phone-row-detail-kv phone-generic-slot-detail-field ${pair.isLocked ? 'is-locked' : ''} ${pair.preferFullRow ? 'is-long-content' : ''} ${state.cellLockManageMode ? 'show-lock-tools' : ''}" data-col-index="${pair.rawColIndex}">
                                <div class="phone-generic-field-header">
                                    <span class="phone-row-detail-key">${escapeHtml(pair.key)}</span>
                                    ${pair.isLocked ? `<span class="phone-generic-field-lock-state">${pair.cellLocked ? '字段锁定' : '整行锁定'}</span>` : ''}
                                </div>
                                ${state.editMode
                                    ? buildDetailEditControlHtml(pair)
                                    : `<span class="phone-row-detail-value">${escapeHtml(pair.value || '—')}</span>`
                                }
                                <div class="phone-row-detail-tools phone-generic-slot-detail-tools">
                                    <button type="button" class="phone-cell-lock-btn ${pair.cellLocked ? 'locked' : ''}" data-cell-lock="${pair.lockColIndex}" data-cell-raw="${pair.rawColIndex}" ${rowLocked ? 'disabled' : ''}>${pair.cellLocked ? '已锁定' : '锁定'}</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="phone-detail-pager-bar phone-generic-slot-pager" aria-label="详情页翻页">
                ${previousHtml}
                ${nextHtml}
            </div>
            <div class="phone-detail-bottom-bar phone-generic-slot-actions" data-phone-bottom-bar>
                <button type="button" class="phone-detail-bottom-btn" id="phone-toggle-edit-mode">${state.editMode ? '退出编辑' : '进入编辑'}</button>
                <button type="button" class="phone-detail-bottom-btn" id="phone-save-row" ${state.editMode && !rowLocked ? '' : 'disabled'}>${state.saving ? '保存中...' : '保存更改'}</button>
                <button type="button" class="phone-detail-bottom-btn ${state.cellLockManageMode ? 'active' : ''}" id="phone-cell-lock-mode-btn">${state.cellLockManageMode ? '完成' : '字段锁定'}</button>
            </div>
        </div>
    `;
}
