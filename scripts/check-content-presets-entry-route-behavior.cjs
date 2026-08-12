const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeHTMLElement {
    constructor() {
        this.dataset = {};
        this.classList = {
            add: () => {},
            remove: () => {},
        };
        this.listeners = new Map();
        this.queryResults = new Map();
        this.closestApp = null;
        this.children = new Set();
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    removeEventListener(type) {
        this.listeners.delete(type);
    }

    contains(node) {
        return node === this || this.children.has(node);
    }

    closest(selector) {
        return selector === '.phone-app-item' ? this.closestApp : null;
    }

    querySelector(selector) {
        return this.queryResults.get(selector) || null;
    }

    dispatch(type, event) {
        this.listeners.get(type)?.(event);
    }
}

function moduleUrl(relativePath) {
    return pathToFileURL(path.resolve(relativePath)).href;
}

function installDom() {
    global.HTMLElement = FakeHTMLElement;
    global.Element = FakeHTMLElement;
}

function createRuntime() {
    const queue = [];
    return {
        addEventListener(target, type, handler) {
            target.addEventListener(type, handler);
            return () => target.removeEventListener(type, handler);
        },
        registerCleanup: () => {},
        isDisposed: () => false,
        setTimeout(callback) {
            queue.push(callback);
            return queue.length;
        },
        flush() {
            while (queue.length > 0) queue.shift()();
        },
    };
}

function sheet(name, orderNo, content = [['字段']]) {
    return { name, orderNo, content };
}

function createRawData() {
    return {
        sheet_generic: sheet('普通表', 1, [['字段'], ['普通数据']]),
        sheet_contacts: sheet('联系人表', 2, [['姓名'], ['Alice']]),
        sheet_square: sheet('广场表', 3, [['帖子ID'], ['post-1']]),
    };
}

async function checkHomeCatalogRoutes(rawData) {
    const { buildHomeScreenViewModel } = await import(moduleUrl('modules/phone-home/view-model.js'));
    const viewModel = buildHomeScreenViewModel(rawData, {});
    const genericApp = viewModel.apps.find(app => app.key === 'sheet_generic');
    const contactsApp = viewModel.apps.find(app => app.key === 'sheet_contacts');
    const theaterApp = viewModel.apps.find(app => app.isTheaterApp && app.theaterSceneId === 'square');

    assert.equal(genericApp?.route, 'table:sheet_generic');
    assert.equal(contactsApp?.route, 'table:sheet_contacts');
    assert.equal(theaterApp?.route, 'table:sheet_square');
    assert.equal(theaterApp?.route.startsWith('table:'), true);
    assert.equal(viewModel.apps.some(app => app.key === 'sheet_square'), false, 'Theater 主物理表不得重复显示为普通 App');
}

async function checkHomeGridNavigation() {
    const { bindHomeGridInteractions } = await import(moduleUrl('modules/phone-home/interactions.js'));
    const navigated = [];
    const runtime = createRuntime();
    const grid = new FakeHTMLElement();
    const app = new FakeHTMLElement();
    const target = new FakeHTMLElement();
    const icon = new FakeHTMLElement();
    app.dataset.sheetKey = 'sheet_contacts';
    app.dataset.route = 'table:sheet_contacts';
    app.queryResults.set('.phone-app-icon', icon);
    target.closestApp = app;
    grid.children.add(app);

    bindHomeGridInteractions(grid, { runtime, navigateTo: route => navigated.push(route) });
    grid.dispatch('click', { target });
    runtime.flush();
    assert.deepEqual(navigated, ['table:sheet_contacts']);

    const missingRouteGrid = new FakeHTMLElement();
    const missingRouteApp = new FakeHTMLElement();
    const missingRouteTarget = new FakeHTMLElement();
    missingRouteApp.dataset.sheetKey = 'sheet_generic';
    missingRouteTarget.closestApp = missingRouteApp;
    missingRouteGrid.children.add(missingRouteApp);
    bindHomeGridInteractions(missingRouteGrid, { runtime: createRuntime(), navigateTo: route => navigated.push(route) });
    missingRouteGrid.dispatch('click', { target: missingRouteTarget });
    assert.deepEqual(navigated, ['table:sheet_contacts'], '缺少 route 的首页 App 不得 fallback 到 app:');
}

async function checkSlashCatalogRoute(rawData) {
    const { __test__createOpenTableInPhone } = await import(moduleUrl('modules/bootstrap/command-registry.js'));
    const navigated = [];
    const openTableInPhone = __test__createOpenTableInPhone({
        getTableData: () => rawData,
        navigateTo: route => navigated.push(route),
    });

    const opened = openTableInPhone('联系人表', () => true);
    assert.equal(opened.ok, true);
    assert.deepEqual(navigated, ['table:sheet_contacts']);

    const unavailable = openTableInPhone('联系人表', () => false);
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.code, 'phone_unavailable');
    assert.deepEqual(navigated, ['table:sheet_contacts']);
}

async function checkLegacyRouteBypass(rawData) {
    const { resolveContentPresetRouteTarget } = await import(moduleUrl('modules/content-presets/route-target.js'));
    assert.equal(resolveContentPresetRouteTarget('table:sheet_generic', rawData).bypass, false);
    for (const route of ['app:sheet_generic', 'theater:square', 'table-generic:sheet_generic']) {
        assert.equal(resolveContentPresetRouteTarget(route, rawData).bypass, true, `${route} 必须永久旁路 preset`);
    }
}

async function checkLegacyRouteConvergence(rawData) {
    const { convergeCurrentContentPresetRoute } = await import(moduleUrl('modules/content-presets/route-convergence.js'));
    const calls = [];
    const converge = (route, affectedSheetKeys) => convergeCurrentContentPresetRoute(affectedSheetKeys, {
        getCurrentRoute: () => route,
        getTableData: () => rawData,
        requestCurrentPhoneRouteRender: options => {
            calls.push(options);
            return true;
        },
    });

    assert.equal(await converge('table:sheet_generic', ['sheet_generic']), true);
    assert.deepEqual(calls, [{ requestMode: 'content-preset-convergence' }]);

    for (const [route, affectedSheetKeys] of [
        ['app:sheet_generic', ['sheet_generic']],
        ['theater:square', ['sheet_square']],
        ['table-generic:sheet_generic', ['sheet_generic']],
    ]) {
        calls.length = 0;
        assert.equal(await converge(route, affectedSheetKeys), false, `${route} 不得触发 convergence`);
        assert.deepEqual(calls, []);
    }
}

async function main() {
    installDom();
    const rawData = createRawData();
    await checkHomeCatalogRoutes(rawData);
    await checkHomeGridNavigation();
    await checkSlashCatalogRoute(rawData);
    await checkLegacyRouteBypass(rawData);
    await checkLegacyRouteConvergence(rawData);
    console.log('[content-presets-entry-route-behavior-check] 检查通过');
}

main().catch(error => {
    console.error('[content-presets-entry-route-behavior-check] 检查失败：', error);
    process.exitCode = 1;
});
