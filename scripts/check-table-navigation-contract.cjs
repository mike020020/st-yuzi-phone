const assert = require('assert/strict');
const fs = require('fs');
const { pathToFileURL } = require('url');
const path = require('path');

function sheet(name, orderNo, content = [['字段']]) {
    return { name, orderNo, content };
}

async function main() {
    const moduleUrl = pathToFileURL(path.resolve('modules/table-navigation/catalog.js')).href;
    const {
        buildTableNavigationCatalog,
        resolveTableNavigationTarget,
        resolveAdjacentTableTarget,
    } = await import(moduleUrl);
    const controlsUrl = pathToFileURL(path.resolve('modules/table-navigation/controls.js')).href;
    const { buildTableNavigationControlState, requestTableNavigationSwitch } = await import(controlsUrl);
    const dataApiUrl = pathToFileURL(path.resolve('modules/phone-core/data-api.js')).href;
    const { getSheetKeys } = await import(dataApiUrl);
    const routeRendererUrl = pathToFileURL(path.resolve('modules/phone-core/route-renderer.js')).href;
    const { __test__loadRouteRenderer } = await import(routeRendererUrl);
    const reviewInteractionsUrl = pathToFileURL(path.resolve('modules/table-update-review/interactions.js')).href;
    const { executeTableUpdateReviewNavigation } = await import(reviewInteractionsUrl);
    const theaterDataUrl = pathToFileURL(path.resolve('modules/phone-theater/data.js')).href;
    const { resolveTheaterNavigationSheetKey } = await import(theaterDataUrl);
    const theaterInteractionsUrl = pathToFileURL(path.resolve('modules/phone-theater/interactions.js')).href;
    const { __test__navigateToEditableTable } = await import(theaterInteractionsUrl);

    assert.deepEqual(buildTableNavigationCatalog(null), []);
    assert.equal(resolveTableNavigationTarget({}, ''), null);

    const rawData = {
        mate: { type: 'chatSheets' },
        sheet_z: sheet('Z表', 2),
        sheet_b: sheet('B表', 1),
        sheet_a: sheet('A表', 1),
        sheet_invalid_order: sheet('无序表', '3'),
        sheet_message: sheet('消息记录表', Number.NaN),
    };
    const catalog = buildTableNavigationCatalog(rawData);
    assert.deepEqual(
        catalog.map(item => item.sheetKey),
        getSheetKeys(rawData),
        '目录必须完全沿用 getSheetKeys 的 orderNo/表名排序',
    );
    assert.deepEqual(
        catalog.map(item => item.orderIndex),
        [0, 1, 2, 3, 4],
        'orderIndex 必须对应最终物理表顺序',
    );
    assert.equal(resolveTableNavigationTarget(rawData, 'sheet_message').presentation, 'special');
    assert.equal(resolveTableNavigationTarget(rawData, 'sheet_message').specialType, 'message');
    assert.equal(resolveTableNavigationTarget(rawData, 'sheet_a').presentation, 'generic');
    assert.equal(resolveTableNavigationTarget(rawData, 'sheet_a').route, 'table:sheet_a');
    assert.equal(resolveTableNavigationTarget(rawData, 'missing'), null);

    const theaterData = {
        sheet_square: sheet('广场表', 1, [['帖子ID'], ['post-1']]),
    };
    const theaterTarget = resolveTableNavigationTarget(theaterData, 'sheet_square');
    assert.equal(theaterTarget.presentation, 'theater');
    assert.equal(theaterTarget.sceneId, 'square');
    assert.equal(theaterTarget.route, 'table:sheet_square');

    const unavailableTheaterData = {
        sheet_calendar_relation: sheet('小日历关系表', 1),
    };
    assert.equal(
        resolveTableNavigationTarget(unavailableTheaterData, 'sheet_calendar_relation').presentation,
        'generic',
        '缺少主表的 Theater 子表必须降级 Generic',
    );

    assert.equal(resolveAdjacentTableTarget({}, 'sheet_a', 'next').reason, 'empty_catalog');
    assert.equal(resolveAdjacentTableTarget({ sheet_a: sheet('A', 1) }, 'sheet_a', 'next').reason, 'single_table');
    assert.equal(resolveAdjacentTableTarget(rawData, 'missing', 'next').reason, 'anchor_not_found');
    assert.equal(resolveAdjacentTableTarget(rawData, 'sheet_a', 'sideways').reason, 'invalid_direction');
    assert.equal(resolveAdjacentTableTarget(rawData, 'sheet_a', 'previous').target.sheetKey, getSheetKeys(rawData).at(-1));
    assert.equal(resolveAdjacentTableTarget(rawData, getSheetKeys(rawData).at(-1), 'next').target.sheetKey, 'sheet_a');
    assert.equal(resolveAdjacentTableTarget(rawData, 'sheet_b', 'next').target.sheetKey, 'sheet_z');

    const singleControlState = buildTableNavigationControlState(
        { sheet_a: sheet('A', 1) },
        'sheet_a',
    );
    assert.equal(singleControlState.disabled, true);
    assert.equal(singleControlState.reason, 'single_table');

    const blockedControlState = buildTableNavigationControlState(rawData, 'sheet_a', { blocked: true });
    assert.equal(blockedControlState.previous.disabled, true);
    assert.equal(blockedControlState.next.reason, 'blocked');

    const replacedRoutes = [];
    const switchResult = requestTableNavigationSwitch('sheet_a', 'next', {
        getTableData: () => rawData,
        replaceCurrentRoute: route => replacedRoutes.push(route),
        isActive: () => true,
    });
    assert.equal(switchResult.navigated, true);
    assert.deepEqual(replacedRoutes, ['table:sheet_b']);

    const blockedSwitch = requestTableNavigationSwitch('sheet_a', 'next', {
        blocked: true,
        getTableData: () => {
            throw new Error('blocked 时不应读取数据库');
        },
        replaceCurrentRoute: () => {
            throw new Error('blocked 时不应导航');
        },
    });
    assert.equal(blockedSwitch.reason, 'blocked');

    let activeChecks = 0;
    const inactiveAfterRead = requestTableNavigationSwitch('sheet_a', 'next', {
        getTableData: () => rawData,
        replaceCurrentRoute: () => {
            throw new Error('失活后不应发布 replace');
        },
        isActive: () => ++activeChecks === 1,
    });
    assert.equal(inactiveAfterRead.reason, 'inactive');

    const rendered = [];
    const routeDeps = {
        getTableData: () => rawData,
        resolveTableNavigationTarget: (_data, sheetKey) => ({
            sheetKey,
            sceneId: 'square',
            presentation: sheetKey === 'theater' ? 'theater' : sheetKey === 'special' ? 'special' : 'generic',
        }),
        renderTableViewer: (...args) => rendered.push({ kind: 'viewer', args }),
        renderTheaterScene: (...args) => rendered.push({ kind: 'theater', args }),
    };

    const genericRenderer = await __test__loadRouteRenderer('table:generic', 11, routeDeps);
    assert.equal(genericRenderer.routeType, 'table-generic-auto');
    genericRenderer.render({ page: 'generic' });
    assert.deepEqual(rendered.pop(), {
        kind: 'viewer',
        args: [{ page: 'generic' }, 'generic', { forceGenericList: true, navigationSheetKey: 'generic' }],
    });

    const specialRenderer = await __test__loadRouteRenderer('table:special', 12, routeDeps);
    assert.equal(specialRenderer.routeType, 'table-special');
    specialRenderer.render({ page: 'special' });
    assert.deepEqual(rendered.pop(), {
        kind: 'viewer',
        args: [{ page: 'special' }, 'special', { forceGenericList: false, navigationSheetKey: 'special' }],
    });

    const theaterRenderer = await __test__loadRouteRenderer('table:theater', 13, routeDeps);
    assert.equal(theaterRenderer.routeType, 'table-theater');
    theaterRenderer.render({ page: 'theater' });
    assert.deepEqual(rendered.pop(), {
        kind: 'theater',
        args: [{ page: 'theater' }, 'square', { renderToken: 13, navigationSheetKey: 'theater' }],
    });

    const appTheaterRenderer = await __test__loadRouteRenderer('app:theater', 14, routeDeps);
    assert.equal(appTheaterRenderer.routeType, 'theater-app-redirect');
    appTheaterRenderer.render({ page: 'app-theater' });
    assert.deepEqual(rendered.pop(), {
        kind: 'theater',
        args: [{ page: 'app-theater' }, 'square', { renderToken: 14, navigationSheetKey: 'theater' }],
    });

    const forcedGenericRenderer = await __test__loadRouteRenderer('table-generic:special', 15, routeDeps);
    forcedGenericRenderer.render({ page: 'forced-generic' });
    assert.deepEqual(rendered.pop(), {
        kind: 'viewer',
        args: [{ page: 'forced-generic' }, 'special', { forceGenericList: true }],
    });

    const explicitTheaterRenderer = await __test__loadRouteRenderer('theater:square', 16, routeDeps);
    explicitTheaterRenderer.render({ page: 'explicit-theater' });
    assert.deepEqual(rendered.pop(), {
        kind: 'theater',
        args: [{ page: 'explicit-theater' }, 'square', { renderToken: 16 }],
    });

    const realTableTheaterRenderer = await __test__loadRouteRenderer('table:theater', 17, {
        getTableData: routeDeps.getTableData,
        resolveTableNavigationTarget: routeDeps.resolveTableNavigationTarget,
    });
    assert.equal(
        realTableTheaterRenderer.routeType,
        'table-theater',
        '物理 Theater route 必须能加载真实 phone-theater renderer 模块',
    );
    assert.equal(typeof realTableTheaterRenderer.render, 'function');

    assert.equal(await __test__loadRouteRenderer('table:', 18, routeDeps), null);
    assert.equal(await __test__loadRouteRenderer('table:missing', 19, {
        ...routeDeps,
        resolveTableNavigationTarget: () => null,
    }), null);

    const reviewCalls = [];
    const reviewDeps = {
        getTableData: () => rawData,
        navigateTo: route => reviewCalls.push({ kind: 'navigate', route }),
        setPendingTableReviewNavigationIntent: intent => {
            reviewCalls.push({ kind: 'intent', intent });
            return true;
        },
    };
    const theaterReview = executeTableUpdateReviewNavigation({ sheetKey: 'theater', changeType: 'update' }, {
        ...reviewDeps,
        resolveTableNavigationTarget: () => ({ presentation: 'theater', route: 'table:theater' }),
    });
    assert.equal(theaterReview.route, 'table:theater');
    assert.deepEqual(reviewCalls, [{ kind: 'navigate', route: 'table:theater' }], 'Theater 审核不得写 Generic intent');

    reviewCalls.length = 0;
    const specialReview = executeTableUpdateReviewNavigation({ sheetKey: 'special', rowId: 'r1', rowIndex: 2, changeType: 'update', createdAt: 1 }, {
        ...reviewDeps,
        resolveTableNavigationTarget: () => ({ presentation: 'special', route: 'table:special' }),
    });
    assert.equal(specialReview.route, 'table-generic:special');
    assert.equal(reviewCalls[0].kind, 'intent');
    assert.equal(reviewCalls[1].route, 'table-generic:special');

    let deleteReadCount = 0;
    const deleteReview = executeTableUpdateReviewNavigation({ sheetKey: 'generic', changeType: 'delete' }, {
        getTableData: () => {
            deleteReadCount += 1;
            return rawData;
        },
    });
    assert.equal(deleteReview.reason, 'delete');
    assert.equal(deleteReadCount, 0, '删除审核项不得读取目录或导航');

    const navigationViewModel = {
        scene: { primaryTableRole: 'primary' },
        tables: {
            primary: null,
            later: { sheetKey: 'sheet_later' },
            earlier: { sheetKey: 'sheet_earlier' },
        },
    };
    const navigationRawData = {
        sheet_later: sheet('稍后表', 2),
        sheet_earlier: sheet('较早表', 1),
    };
    assert.equal(resolveTheaterNavigationSheetKey(navigationRawData, navigationViewModel, 'sheet_later'), 'sheet_later');
    assert.equal(resolveTheaterNavigationSheetKey(navigationRawData, navigationViewModel, ''), 'sheet_earlier', '主表缺失时必须按 getSheetKeys 选择 scene 稳定首项');

    const editNavigationCalls = [];
    const createEditDeps = (currentRoute, routeHistory) => ({
        getCurrentRoute: () => currentRoute,
        getRouteHistory: () => routeHistory,
        navigateTo: route => editNavigationCalls.push({ kind: 'push', route }),
        navigateToReplacingHistoryTop: route => editNavigationCalls.push({ kind: 'replace-history-top', route }),
    });
    assert.equal(__test__navigateToEditableTable({ sheetKey: '' }, createEditDeps('theater:square', [])), false);
    assert.equal(editNavigationCalls.length, 0);

    assert.equal(__test__navigateToEditableTable(
        { sheetKey: 'sheet_a' },
        createEditDeps('theater:square', [{ route: 'home' }]),
    ), true);
    assert.deepEqual(editNavigationCalls.pop(), { kind: 'push', route: 'table-generic:sheet_a' }, '首次 Theater 编辑必须普通 push，保留当前美化页');

    assert.equal(__test__navigateToEditableTable(
        { sheetKey: 'sheet_review' },
        createEditDeps('table:sheet_review', [{ route: 'table-update-review' }]),
    ), true);
    assert.deepEqual(editNavigationCalls.pop(), { kind: 'push', route: 'table-generic:sheet_review' }, '审核来源首次编辑不得替换审核 history');

    for (const previousBrowsingRoute of ['app:sheet_a', 'theater:square', 'table:sheet_a']) {
        assert.equal(__test__navigateToEditableTable(
            { sheetKey: 'sheet_c' },
            createEditDeps('table:sheet_c', [{ route: 'home' }, { route: previousBrowsingRoute }]),
        ), true);
        assert.deepEqual(
            editNavigationCalls.pop(),
            { kind: 'replace-history-top', route: 'table-generic:sheet_c' },
            `跨表 Theater 编辑必须替换旧浏览锚点：${previousBrowsingRoute}`,
        );
    }

    const routeRenderer = fs.readFileSync(path.resolve('modules/phone-core/route-renderer.js'), 'utf8');
    const preload = fs.readFileSync(path.resolve('modules/phone-core/preload.js'), 'utf8');
    const controls = fs.readFileSync(path.resolve('modules/table-navigation/controls.js'), 'utf8');
    const tableRouteIndex = routeRenderer.indexOf('route.startsWith(TABLE_ROUTE_PREFIX)');
    const appRouteIndex = routeRenderer.indexOf("route.startsWith('app:')");
    assert(tableRouteIndex >= 0 && appRouteIndex > tableRouteIndex, 'table 物理路由必须先于兼容 app 路由处理');
    assert(routeRenderer.includes('resolveTableNavigationTarget(getTableData(), sheetKey)'), 'table 路由必须复用统一目录分类');
    assert(routeRenderer.includes("routeType: 'table-theater'")
        && routeRenderer.includes('renderTheaterScene(page, target.sceneId, {')
        && routeRenderer.includes('navigationSheetKey: target.sheetKey'), 'table Theater 分支必须保留物理锚点');
    assert(routeRenderer.includes("routeType: target.presentation === 'special' ? 'table-special' : 'table-generic-auto'")
        && routeRenderer.includes("forceGenericList: target.presentation === 'generic'"), 'table Special/Generic 分支必须只对 Generic 强制列表');
    assert(routeRenderer.includes('if (!sheetKey) return null;')
        && routeRenderer.includes('if (!target) return null;'), '无效 table 路由不得创建可提交页面');
    assert(preload.includes("'../table-navigation/catalog.js'")
        && preload.includes("'../table-viewer/render.js'")
        && preload.includes("'../phone-theater/render.js'"), 'table 路由动态入口必须纳入 preload');
    assert(controls.includes("import { replaceCurrentRoute } from '../phone-core/routing.js';")
        && controls.includes('const replaceRoute = options.replaceCurrentRoute || replaceCurrentRoute;')
        && controls.includes('replaceRoute(result.target.route);'), '表级切换成功路径必须使用可测试注入的 replaceCurrentRoute');
    assert(!controls.includes('navigateTo(')
        && !controls.includes('routeHistory')
        && !controls.includes('currentRoute ='), '共享切换控件不得污染 route/history');

    console.log('[table-navigation-contract-check] 检查通过');
    console.log('- OK | 目录严格复用 getSheetKeys 顺序');
    console.log('- OK | Theater / Special / Generic 分类与降级正确');
    console.log('- OK | 零表、单表、缺失锚点、非法方向与首尾循环正确');
    console.log('- OK | 控件状态、点击时重读、blocked 与 lifecycle 二次 guard 正确');
    console.log('- OK | table 路由分流、preload 与 replace-only 合同正确');
    console.log('- OK | route loader、审核分流与 Theater 锚点 fallback 真实行为正确');
    console.log('- OK | Theater 首次编辑保留来源，跨表重复编辑压缩旧美化页 history');
}

main().catch((error) => {
    console.error('[table-navigation-contract-check] 检查失败：', error);
    process.exitCode = 1;
});
