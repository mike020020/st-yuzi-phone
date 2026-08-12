import { getTableData } from '../phone-core/data-api.js';
import { navigateBack, navigateTo } from '../phone-core/routing.js';
import { resolveTableNavigationTarget } from '../table-navigation/catalog.js';
import { createTableReviewNavigationAttemptId, setPendingTableReviewNavigationIntent } from './navigation-intent.js';

export function executeTableUpdateReviewNavigation(payload = {}, deps = {}) {
    const sheetKey = String(payload.sheetKey || '').trim();
    const changeType = String(payload.changeType || '').trim();
    if (changeType === 'delete') return { navigated: false, reason: 'delete', route: '' };
    if (!sheetKey) return { navigated: false, reason: 'missing_sheet_key', route: '' };
    const readTableData = deps.getTableData || getTableData;
    const resolveTarget = deps.resolveTableNavigationTarget || resolveTableNavigationTarget;
    const setIntent = deps.setPendingTableReviewNavigationIntent || setPendingTableReviewNavigationIntent;
    const createAttemptId = deps.createTableReviewNavigationAttemptId || createTableReviewNavigationAttemptId;
    const navigate = deps.navigateTo || navigateTo;
    const target = resolveTarget(readTableData(), sheetKey);
    if (!target) return { navigated: false, reason: 'target_not_found', route: '' };
    const attemptId = createAttemptId();
    const intentAccepted = setIntent({
        attemptId, sheetKey, rowId: String(payload.rowId || '').trim(), rowIndex: Number(payload.rowIndex), changeType,
        createdAt: Number.isFinite(Number(payload.createdAt)) ? Number(payload.createdAt) : Date.now(),
    });
    if (!intentAccepted) return { navigated: false, reason: 'intent_rejected', route: '' };
    navigate(target.route, { reviewNavigationAttemptId: attemptId });
    return { navigated: true, reason: '', route: target.route, presentation: target.presentation, attemptId };
}

export function bindTableUpdateReviewInteractions(container, options = {}) {
    if (!(container instanceof HTMLElement)) return () => {};
    const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
    const onClick = (event) => {
        if (!isActive()) return;
        const actionEl = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!(actionEl instanceof HTMLElement) || !container.contains(actionEl)) return;
        const action = String(actionEl.dataset.action || '').trim();
        if (action === 'nav-back') { navigateBack(); return; }
        if (action === 'open-review-change') executeTableUpdateReviewNavigation({
            sheetKey: String(actionEl.dataset.sheetKey || '').trim(), rowId: String(actionEl.dataset.rowId || '').trim(),
            rowIndex: Number(actionEl.dataset.rowIndex), changeType: String(actionEl.dataset.changeType || '').trim(), createdAt: Date.now(),
        });
    };
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
}
