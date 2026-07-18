const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    tableViewerRender: 'modules/table-viewer/render.js',
    tableContext: 'modules/table-viewer/context.js',
    genericViewer: 'modules/table-viewer/generic-viewer.js',
    genericRuntime: 'modules/table-viewer/generic-runtime.js',
    listPageRenderer: 'modules/table-viewer/list-page-renderer.js',
    listPageTemplate: 'modules/table-viewer/list-page-template.js',
    listPageController: 'modules/table-viewer/list-page-controller.js',
    specialRuntime: 'modules/table-viewer/special/runtime.js',
    viewerRuntime: 'modules/table-viewer/runtime.js',
    genericCss: 'styles/05-phone-generic-template.css',
    specialCss: 'styles/04-phone-special-interactions.css',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];

    check(results, 'viewerRuntime', 'viewer-runtime 暴露 createViewerRuntime()', has(contents.viewerRuntime, 'export function createViewerRuntime('));
    check(results, 'viewerRuntime', 'viewer-runtime 暴露 bindExternalTableUpdate()', has(contents.viewerRuntime, 'const bindExternalTableUpdate = (handler) => {'));
    check(results, 'viewerRuntime', 'viewer-runtime 暴露 bindDraftPreview()', has(contents.viewerRuntime, 'const bindDraftPreview = () => {'));
    check(results, 'viewerRuntime', 'viewer-runtime 暴露 startViewerSession()', has(contents.viewerRuntime, 'const startViewerSession = (options = {}) => {'));
    check(results, 'viewerRuntime', 'viewer-runtime startViewerSession() 取得 currentViewingSheet owner', has(contents.viewerRuntime, 'resolvedRuntimeDeps.acquireCurrentViewingSheet(sheetKey);'));
    check(results, 'viewerRuntime', 'viewer-runtime dispose() 只释放自身 currentViewingSheet owner', has(contents.viewerRuntime, 'resolvedRuntimeDeps.releaseCurrentViewingSheet(viewingSheetOwner);'));
    check(results, 'viewerRuntime', 'viewer-runtime startViewerSession() 继续重置数据版本', has(contents.viewerRuntime, 'resolvedRuntimeDeps.resetDataVersion();'));
    check(results, 'viewerRuntime', 'viewer-runtime 继续托管 cleanupObserver', has(contents.viewerRuntime, 'let cleanupObserver = null;'));
    check(results, 'viewerRuntime', 'viewer-runtime observeContainerRemoval() 通过 runtime scope 的 observeDisconnection() 收口', has(contents.viewerRuntime, 'cleanupObserver = viewerRuntimeScope.observeDisconnection(container, () => {')
        && has(contents.viewerRuntime, 'observerRoot,')
        && has(contents.viewerRuntime, 'childList: true,')
        && has(contents.viewerRuntime, 'subtree: true,'));

    check(results, 'tableContext', 'table-context 暴露 resolveTableViewerContext()', has(contents.tableContext, 'export function resolveTableViewerContext('));
    check(results, 'tableContext', 'table-context 暴露 renderTableViewerLoadError()', has(contents.tableContext, 'export function renderTableViewerLoadError('));

    check(results, 'tableViewerRender', 'table-viewer render 导入 table context', has(contents.tableViewerRender, './context.js'));
    check(results, 'tableViewerRender', 'table-viewer render 导入 createViewerRuntime()', has(contents.tableViewerRender, "import { createViewerRuntime } from './runtime.js';"));
    check(results, 'tableViewerRender', 'table-viewer render 导入 createSpecialTableViewerRuntime()', has(contents.tableViewerRender, 'createSpecialTableViewerRuntime'));
    check(results, 'tableViewerRender', 'table-viewer render 创建 viewerRuntime', has(contents.tableViewerRender, 'const viewerRuntime = createViewerRuntime({'));
    check(results, 'tableViewerRender', 'table-viewer render 在无效表格时清理 viewerRuntime', has(contents.tableViewerRender, 'viewerRuntime.dispose();'));
    check(results, 'tableViewerRender', 'table-viewer render 通过 viewerRuntime.startViewerSession() 启动会话', has(contents.tableViewerRender, 'viewerRuntime.startViewerSession();'));
    check(results, 'tableViewerRender', 'table-viewer render special 路径改为通过 specialRuntime.start() 启动', has(contents.tableViewerRender, 'specialRuntime?.start();'));
    check(results, 'tableViewerRender', 'table-viewer render 继续向 special runtime 注入 viewerRuntime', has(contents.tableViewerRender, 'viewerRuntime,'));
    check(results, 'tableViewerRender', 'table-viewer render 继续向 generic viewer 注入 viewerRuntime', has(contents.tableViewerRender, 'viewerRuntime,'));
    check(results, 'tableViewerRender', 'table-viewer render 将物理导航锚点分别传入 Special 与 Generic', has(contents.tableViewerRender, "const navigationSheetKey = String(options?.navigationSheetKey || sheetKey || '').trim();")
        && has(contents.tableViewerRender, 'navigationSheetKey,')
        && has(contents.tableViewerRender, 'renderGenericTableViewer(container, {'));

    check(results, 'genericViewer', 'generic-viewer 导入 createGenericTableViewerRuntime()', has(contents.genericViewer, "import { createGenericTableViewerRuntime } from './generic-runtime.js';"));
    check(results, 'genericViewer', 'generic-viewer 接收 viewerRuntime', has(contents.genericViewer, 'const viewerRuntime = hooks.viewerRuntime;'));
    check(results, 'genericViewer', 'generic-viewer 改为委托 runtime.start()', has(contents.genericViewer, 'runtime.start();'));

    check(results, 'genericRuntime', 'generic-runtime 暴露 createGenericTableViewerRuntime()', has(contents.genericRuntime, 'export function createGenericTableViewerRuntime('));
    check(results, 'genericRuntime', 'generic-runtime 继续创建 table viewer state', has(contents.genericRuntime, 'const state = createTableViewerState(sheetKey);'));
    check(results, 'genericRuntime', 'generic-runtime 继续创建 scroll preserver 并注入 viewerRuntime', has(contents.genericRuntime, 'const scrollPreserver = createTableViewerScrollPreserver(container, state, undefined, viewerRuntime);'));
    check(results, 'genericRuntime', 'generic-runtime 暴露 start()', has(contents.genericRuntime, 'const start = () => {'));
    check(results, 'genericRuntime', 'generic-runtime start() 继续委托 bind()', has(contents.genericRuntime, 'bind();'));
    check(results, 'genericRuntime', 'generic-runtime start() 继续委托 render()', has(contents.genericRuntime, 'render();'));
    check(results, 'genericRuntime', 'generic-runtime 继续通过 viewerRuntime 处理 suppressExternalTableUpdate', has(contents.genericRuntime, 'viewerRuntime?.setSuppressExternalTableUpdate(next);'));
    check(results, 'genericRuntime', 'generic-runtime 继续通过 viewerRuntime 绑定外部表更新', has(contents.genericRuntime, 'viewerRuntime.bindExternalTableUpdate(handleTableUpdate);'));
    check(results, 'genericRuntime', 'generic-runtime 只向列表页传递 navigationSheetKey', has(contents.genericRuntime, 'navigationSheetKey = sheetKey,')
        && has(contents.genericRuntime, 'renderListPage({')
        && has(contents.genericRuntime, 'navigationSheetKey,')
        && !has(contents.genericRuntime, 'renderDetailPage({\n                navigationSheetKey,'));

    check(results, 'listPageRenderer', 'Generic 列表基于实时 rawData 构建表级导航状态', has(contents.listPageRenderer, 'buildTableNavigationControlState(')
        && has(contents.listPageRenderer, 'rawData: getTableData(),')
        && has(contents.listPageRenderer, 'navigationSheetKey,'));
    check(results, 'listPageRenderer', 'Generic 列表管理态变化会刷新 nav region', has(contents.listPageRenderer, "changedKeySet.has('deleteManageMode')")
        && has(contents.listPageRenderer, "changedKeySet.has('lockManageMode')")
        && has(contents.listPageRenderer, "changedKeySet.has('deletingRowIndex')")
        && has(contents.listPageRenderer, '|| deleteSelectionChanged'));
    const genericTitleNavigationSource = contents.listPageTemplate.slice(
        contents.listPageTemplate.indexOf('function buildGenericTitleNavigationHtml'),
        contents.listPageTemplate.indexOf('export function buildGenericListNavHtml')
    );
    check(results, 'listPageTemplate', 'Generic 表级控件只存在于列表标题组且按上一张、标题、下一张排列', has(genericTitleNavigationSource, 'phone-generic-title-navigation')
        && has(genericTitleNavigationSource, 'phone-generic-table-navigation')
        && genericTitleNavigationSource.indexOf('data-action="switch-table-previous"') < genericTitleNavigationSource.indexOf('phone-nav-title')
        && genericTitleNavigationSource.indexOf('phone-nav-title') < genericTitleNavigationSource.indexOf('data-action="switch-table-next"')
        && !has(contents.listPageTemplate, 'phone-special-table-navigation')
        && !has(contents.listPageTemplate, 'phone-theater-table-navigation'));
    check(results, 'listPageController', 'Generic 表级切换使用 delegated controller、管理态阻断与 active guard', has(contents.listPageController, 'requestTableNavigationSwitch(')
        && has(contents.listPageController, 'context.navigationSheetKey || context.sheetKey')
        && has(contents.listPageController, 'context.state.deletingRowIndex >= 0')
        && has(contents.listPageController, 'isActive: () => isGenericListContextActive(context)'));
    check(results, 'genericCss', 'Generic 表级导航 CSS 严格限定模板 scope 并覆盖 disabled', has(contents.genericCss, '.phone-generic-root.phone-generic-template-scope .phone-generic-table-navigation') && has(contents.genericCss, '.phone-generic-table-navigation-btn:disabled'));
    const genericNavCssStart = contents.genericCss.indexOf('.phone-generic-slot-nav[data-generic-list-region="nav"]:not(.is-generic-delete-mode) {');
    const genericNavCssEnd = contents.genericCss.indexOf('\n}', genericNavCssStart);
    const genericNavCssSource = contents.genericCss.slice(genericNavCssStart, genericNavCssEnd);
    check(results, 'genericCss', 'Generic 正常列表使用对称侧轨与内容宽度中央列', genericNavCssStart >= 0
        && has(genericNavCssSource, '--phone-generic-nav-side-reserve: 108px;')
        && has(genericNavCssSource, 'minmax(var(--phone-generic-nav-side-reserve), 1fr)')
        && has(genericNavCssSource, 'minmax(0, max-content)'));
    const genericTitleGroupCssStart = contents.genericCss.indexOf('.phone-generic-slot-nav[data-generic-list-region="nav"]:not(.is-generic-delete-mode) .phone-generic-title-navigation {');
    const genericTitleGroupCssEnd = contents.genericCss.indexOf('\n}', genericTitleGroupCssStart);
    const genericTitleGroupCssSource = contents.genericCss.slice(genericTitleGroupCssStart, genericTitleGroupCssEnd);
    check(results, 'genericCss', 'Generic 正常列表标题组默认按内容宽度收紧且排除删除态', genericTitleGroupCssStart >= 0
        && has(genericTitleGroupCssSource, 'grid-template-columns: 30px max-content 30px;')
        && has(genericTitleGroupCssSource, 'align-items: center;')
        && has(genericTitleGroupCssSource, 'gap: 4px;')
        && has(genericTitleGroupCssSource, 'width: fit-content;')
        && has(genericTitleGroupCssSource, 'justify-self: center;'));
    const genericNarrowCssStart = contents.genericCss.indexOf('@media screen and (max-width: 320px)');
    const genericNarrowCssSource = contents.genericCss.slice(genericNarrowCssStart);
    check(results, 'genericCss', 'Generic 320px 仅缩小按钮轨道并继续保留完整内容宽度标题', genericNarrowCssStart >= 0
        && has(genericNarrowCssSource, 'grid-template-columns: 26px max-content 26px;')
        && has(genericNarrowCssSource, 'width: 26px;')
        && has(genericNarrowCssSource, 'height: 26px;'));
    const genericTitleCssStart = contents.genericCss.indexOf('.phone-generic-slot-nav[data-generic-list-region="nav"]:not(.is-generic-delete-mode) .phone-generic-title-navigation > .phone-nav-title');
    const genericTitleCssEnd = contents.genericCss.indexOf('\n}', genericTitleCssStart);
    const genericTitleCssSource = contents.genericCss.slice(genericTitleCssStart, genericTitleCssEnd);
    check(results, 'genericCss', 'Generic 正常列表标题按完整文字宽度布局且不使用省略截断', genericTitleCssStart >= 0
        && has(genericTitleCssSource, 'width: max-content;')
        && has(genericTitleCssSource, 'min-width: max-content;')
        && has(genericTitleCssSource, 'max-width: none;')
        && has(genericTitleCssSource, 'overflow: visible;')
        && has(genericTitleCssSource, 'text-overflow: clip;'));
    check(results, 'specialCss', 'Special 表级导航 CSS 严格限定模板 scope 并覆盖 disabled', has(contents.specialCss, '.phone-special-app.phone-special-template-scope .phone-special-table-navigation') && has(contents.specialCss, '.phone-special-table-navigation-btn:disabled'));

    check(results, 'specialRuntime', 'special-runtime 暴露 createSpecialTableViewerRuntime()', has(contents.specialRuntime, 'export function createSpecialTableViewerRuntime('));
    check(results, 'specialRuntime', 'special-runtime 暴露 renderSpecialTableViewer()', has(contents.specialRuntime, 'export function renderSpecialTableViewer('));
    check(results, 'specialRuntime', 'special-runtime 从 viewerRuntime 解析 viewerEventManager', has(contents.specialRuntime, 'const viewerEventManager = deps.viewerEventManager || viewerRuntime?.viewerEventManager;'));
    check(results, 'specialRuntime', 'special-runtime 暴露 start()', has(contents.specialRuntime, 'const start = () => {'));
    check(results, 'specialRuntime', 'special-runtime renderSpecialTableViewer() 委托 runtime.start()', has(contents.specialRuntime, 'return runtime.start();'));

    check(results, 'viewerRuntime', 'viewer-runtime 移除手写 removedNodes observer 遍历', !has(contents.viewerRuntime, 'for (const mutation of mutations) {'));

    const failed = results.filter(item => !item.ok);
    if (failed.length > 0) {
        console.error('[viewer-runtime-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[viewer-runtime-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
