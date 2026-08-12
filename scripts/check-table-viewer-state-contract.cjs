const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FILES = {
    state: 'modules/table-viewer/state.js',
    genericRuntime: 'modules/table-viewer/generic-runtime.js',
    listController: 'modules/table-viewer/list-page-controller.js',
    reviewIntentResolver: 'modules/table-viewer/review-intent-resolver.js',
    detailController: 'modules/table-viewer/detail-edit-controller.js',
    detailTemplate: 'modules/table-viewer/detail-page-template.js',
    rowDeleteController: 'modules/table-viewer/row-delete-controller.js',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function appearsBefore(content, firstSnippet, secondSnippet) {
    const firstIndex = content.indexOf(firstSnippet);
    const secondIndex = content.indexOf(secondSnippet);
    return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)]),
    );
    const results = [];

    check(results, 'state', 'keeps an initial-state snapshot', has(contents.state, 'this._initialState = { ...initialState };'));
    check(results, 'state', 'limits state writes to known keys', has(contents.state, 'this._allowedKeys = new Set(Object.keys(this._state));'));
    check(results, 'state', 'warns for unknown set keys', has(contents.state, "Logger.warn('[TableViewerState] set:") && has(contents.state, 'invalidKeys'));
    check(results, 'state', 'notifies only changed values', has(contents.state, 'const changedUpdates = Object.fromEntries('));
    check(results, 'state', 'resets from its initial-state snapshot', has(contents.state, 'reset(initialState = this._initialState) {'));
    check(results, 'state', 'warns for unknown reset keys', has(contents.state, "Logger.warn('[TableViewerState] reset:") && has(contents.state, 'invalidKeys'));
    check(results, 'state', 'keeps proxy compatibility', has(contents.state, 'return new Proxy(stateManager, {'));
    check(results, 'state', 'tracks batch delete selection', has(contents.state, 'selectedDeleteRowIndexes: [],'));
    check(results, 'state', 'tracks active batch deletion', has(contents.state, 'deletingSelection: false,'));
    check(results, 'state', 'tracks detail scroll position', has(contents.state, 'detailScrollTop: 0,'));
    check(results, 'state', 'keeps the shared review-update preference', has(contents.state, 'let sharedOnlyShowReviewUpdates = false;')
        && has(contents.state, 'export function getSharedOnlyShowReviewUpdates()')
        && has(contents.state, 'export function setSharedOnlyShowReviewUpdates(next)')
        && has(contents.state, 'onlyShowReviewUpdates: getSharedOnlyShowReviewUpdates(),'));
    check(results, 'state', 'includes the review-update preference in diagnostics', has(contents.state, "'onlyShowReviewUpdates',")
        && has(contents.state, 'onlyShowReviewUpdates: this._state.onlyShowReviewUpdates,'));
    check(results, 'state', 'exposes batch selection actions', has(contents.state, 'setSelectedDeleteRowIndexes(rowIndexes = []) {')
        && has(contents.state, 'clearDeleteSelection() {')
        && has(contents.state, 'setDeletingSelection(enabled) {'));
    check(results, 'state', 'clears delete state before detail mode', has(contents.state, 'selectedDeleteRowIndexes: getClearedRowIndexList(this._state.selectedDeleteRowIndexes),')
        && has(contents.state, 'deletingSelection: false,'));

    check(results, 'genericRuntime', 'creates the viewer state container', has(contents.genericRuntime, 'const state = createTableViewerState(sheetKey);'));
    check(results, 'genericRuntime', 'refreshes on batch delete state changes', has(contents.genericRuntime, "'selectedDeleteRowIndexes',")
        && has(contents.genericRuntime, "'deletingSelection',"));
    check(results, 'genericRuntime', 'refreshes on review-update preference changes', has(contents.genericRuntime, "'onlyShowReviewUpdates',"));
    check(results, 'genericRuntime', 'consumes a review navigation intent by sheet and attempt', has(contents.genericRuntime, 'consumePendingTableReviewNavigationIntent')
        && has(contents.genericRuntime, 'const reviewNavigationIntent = consumePendingTableReviewNavigationIntent(sheetKey, hooks.reviewNavigationAttemptId);')
        && has(contents.genericRuntime, 'resolveReviewIntentTargetRowIndex')
        && has(contents.genericRuntime, 'state.enterDetailMode(rowIndex)')
        && !has(contents.genericRuntime, "state.set('onlyShowReviewUpdates', true);"));
    check(results, 'genericRuntime', 'does not overwrite a review detail target with list mode', has(contents.genericRuntime, 'let enteredReviewDetail = false;')
        && has(contents.genericRuntime, 'enteredReviewDetail = true;')
        && has(contents.genericRuntime, '&& !enteredReviewDetail)'));
    check(results, 'reviewIntentResolver', 'resolves update targets by row id before row index and rejects deletes', has(contents.reviewIntentResolver, 'export function resolveReviewIntentTargetRowIndex')
        && has(contents.reviewIntentResolver, "changeType === 'delete'")
        && has(contents.reviewIntentResolver, "matchedBy: 'rowId'")
        && has(contents.reviewIntentResolver, "matchedBy: 'rowIndex'")
        && appearsBefore(contents.reviewIntentResolver, "if (targetRowId) {", "matchedBy: 'rowIndex'"));
    check(results, 'genericRuntime', 'passes structured deletion to the list page', has(contents.genericRuntime, 'const { deleteRowsFromList } = createRowDeleteController({')
        && has(contents.genericRuntime, 'deleteRowsFromList,'));
    check(results, 'genericRuntime', 'preserves list and detail scroll helpers', has(contents.genericRuntime, "createRerenderWithScroll('listScrollTop', render)")
        && has(contents.genericRuntime, "captureScroll('detailScrollTop')")
        && has(contents.genericRuntime, "restoreScroll('detailScrollTop')"));

    check(results, 'detailController', 'restores detail scroll only for sibling navigation', has(contents.detailController, 'captureDetailScroll')
        && has(contents.detailController, 'restoreDetailScroll')
        && has(contents.detailController, 'function handleNavigateSibling(el)'));
    check(results, 'detailTemplate', 'uses a dedicated detail-back action through the shared control', has(contents.detailTemplate, "buildPhoneBackButton({ action: 'detail-back' })"));
    check(results, 'detailController', 'does not consume list nav-back actions', has(contents.detailController, "target.closest('[data-action=\"detail-back\"]')")
        && !has(contents.detailController, "target.closest('.phone-nav-back')"));
    check(results, 'detailController', 'returns to the list with its scroll restored', has(contents.detailController, 'state.returnToListMode();')
        && has(contents.detailController, 'restoreListScroll();'));

    check(results, 'listController', 'writes search through viewer state', has(contents.listController, 'listSearchQuery: nextValue'));
    check(results, 'listController', 'constrains selection while filtering in delete mode', has(contents.listController, 'selectedDeleteRowIndexes: nextSelection'));
    check(results, 'listController', 'uses explicit batch delete actions', has(contents.listController, 'context.state.setDeletingSelection(true);')
        && has(contents.listController, 'context.state.setSelectedDeleteRowIndexes(Array.from(selectedRows));')
        && has(contents.listController, 'context.state.setSelectedDeleteRowIndexes(allSelected ? [] : visibleRows);'));
    check(results, 'listController', 'clears batch delete state and synchronizes locks after deletion', has(contents.listController, 'nextContext.state.batchUpdate({')
        && has(contents.listController, 'deletingSelection: false,')
        && has(contents.listController, 'lockState: nextContext.getTableLockState(nextContext.sheetKey),'));
    check(results, 'listController', 'shares the review-update preference across generic viewers', has(contents.listController, "case 'toggle-review-updates-only':")
        && has(contents.listController, 'setSharedOnlyShowReviewUpdates(nextOnlyShowReviewUpdates);')
        && has(contents.listController, "context.state.set('onlyShowReviewUpdates', nextOnlyShowReviewUpdates);"));

    check(results, 'detailController', 'uses explicit edit-mode state actions', has(contents.detailController, 'state.setEditMode(!state.editMode);'));
    check(results, 'rowDeleteController', 'remaps locks after rows are deleted', has(contents.rowDeleteController, 'remapTableLockStateAfterRowsDelete(sheetKey, deletedRowIndexes);'));
    check(results, 'rowDeleteController', 'keeps remaining selections after partial deletion', has(contents.rowDeleteController, 'state.setSelectedDeleteRowIndexes(notDeletedViewRowIndexes);')
        && has(contents.rowDeleteController, 'state.clearDeleteSelection();'));

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[table-viewer-state-contract-check] failed:');
        failed.forEach((item) => console.error(`- ${item.file}: ${item.description}`));
        process.exitCode = 1;
        return;
    }

    console.log('[table-viewer-state-contract-check] passed');
    results.forEach((item) => console.log(`- OK | ${item.file} | ${item.description}`));
}

main();
