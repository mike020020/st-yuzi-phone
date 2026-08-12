const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeHTMLElement {
    constructor(tag = 'div') {
        this.tag = tag;
        this.children = [];
        this.className = '';
        this.innerHTML = '';
        this.removed = false;
        this.scrollTop = 0;
        this.scrollHeight = 500;
        this.clientHeight = 100;
    }
    replaceChildren(...children) {
        this.children = children;
        this.lastReplacedChildren = children;
        children.forEach(child => { child.parentElement = this; });
    }
    prepend(child) { this.children.unshift(child); child.parentElement = this; }
    remove() { this.removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

function installDom() {
    global.HTMLElement = FakeHTMLElement;
    global.Element = FakeHTMLElement;
    global.document = { createElement: tag => new FakeHTMLElement(tag) };
}

function createFixture(overrides = {}) {
    const state = { routeRenderToken: 7, currentRoute: 'table:sheet-a' };
    const rootState = {
        root: null,
        fallbackCalls: 0,
        commitCalls: 0,
        importCalls: 0,
        mountCalls: 0,
        assetDisposeCalls: 0,
        presetAssetsDisposeCalls: 0,
        presetAssetsCreateArgs: [],
        presetAssets: null,
        contextOptions: null,
        moduleDisposeCalls: 0,
        contextDisposeCalls: 0,
        releaseCalls: 0,
        publishCalls: [],
        scrollWrites: [],
        scrollRestoreCalls: [],
        scrollCancelCalls: 0,
        updateCallback: null,
        instanceOptions: null,
        instance: null,
        authorDisposeCalls: 0,
    };
    const rawData = { 'sheet-a': { name: '测试表', orderNo: 1, content: [['字段'], ['值']] } };
    const record = { id: 'preset-a', files: { 'page.html': { content: '<main>ok</main>' }, 'page.js': { content: 'export function mount() {}' } }, items: [{ id: 'item-a', activatable: true, target: { tableName: '测试表', fields: ['字段'] }, entry: { html: 'page.html', mount: 'page.js' } }] };
    const deps = {
        isContentPresetFullPageRuntimeEnabled: () => true,
        getContentPresetIndexSnapshot: () => ({ status: 'ready', activeByTable: new Map([['sheet-a', { presetId: 'preset-a', itemId: 'item-a' }]]) }),
        getPhoneCoreState: () => state,
        getTableData: () => rawData,
        getPresetRecord: async () => record,
        acquireCurrentViewingSheet: () => ({}),
        releaseCurrentViewingSheet: () => { rootState.releaseCalls += 1; },
        createContentPresetInstance: (options) => {
            rootState.instanceOptions = options;
            let disposer = null;
            let disposerCalled = false;
            let disposed = false;
            const callDisposer = (value) => {
                if (disposerCalled || typeof value !== 'function') return;
                disposerCalled = true;
                value();
            };
            const instance = {
                signal: {},
                isCurrent: () => !disposed,
                transition: () => true,
                setAuthorDisposer: (value) => {
                    if (disposed) { callDisposer(value); return; }
                    if (typeof value === 'function') disposer = value;
                },
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    options.onStopUpdates?.();
                    options.onCaptureScroll?.();
                    callDisposer(disposer);
                    options.onHostCleanup?.();
                },
            };
            rootState.instance = instance;
            return instance;
        },
        registerRoutePageCleanup: () => () => {},
        createAssetRuntime: () => ({ rewriteHtml: value => value, rewriteCss: value => value, resolveAsset: () => '', dispose: () => { rootState.assetDisposeCalls += 1; } }),
        createPresetAssetsRuntime: presetId => {
            rootState.presetAssetsCreateArgs.push(presetId);
            rootState.presetAssets = { dispose: () => { rootState.presetAssetsDisposeCalls += 1; } };
            return rootState.presetAssets;
        },
        createContentPresetActions: () => ({}),
        createContentPresetRuntimeContextController: options => {
            rootState.contextOptions = options;
            return { context: {}, publish: stateValue => { rootState.publishCalls.push(stateValue); }, dispose: () => { rootState.contextDisposeCalls += 1; } };
        },
        importContentPresetModule: async () => { rootState.importCalls += 1; return { mount: () => {}, disposeModuleUrl: () => { rootState.moduleDisposeCalls += 1; } }; },
        invokeContentPresetMount: async ({ mount }) => { rootState.mountCalls += 1; return mount(); },
        matchesPresetItem: () => true,
        resolveStableChatId: () => 'chat-a',
        subscribeTableUpdate: callback => { rootState.updateCallback = callback; return () => {}; },
        contentPresetScrollRegistry: {
            write: (...args) => rootState.scrollWrites.push(args),
            restore: (...args) => {
                rootState.scrollRestoreCalls.push(args);
                return () => { rootState.scrollCancelCalls += 1; };
            },
        },
        ...(typeof overrides === 'function' ? overrides(rootState) : overrides),
    };
    return { deps, rootState };
}

async function renderCase(factory, overrides = {}, options = {}) {
    const { deps, rootState } = createFixture(overrides);
    const render = factory(deps);
    const page = new FakeHTMLElement('page');
    const result = await render(page, { sheetKey: 'sheet-a', route: 'table:sheet-a' }, {
        renderToken: 7,
        onCommitted() { rootState.commitCalls += 1; options.onCommitted?.(); },
        originalRenderer() { rootState.fallbackCalls += 1; },
    });
    rootState.root = page.children[0] || page.lastReplacedChildren?.[0] || null;
    return { result, rootState };
}

async function main() {
    installDom();
    const moduleUrl = pathToFileURL(path.resolve('modules/content-presets/renderer.js')).href;
    const { __test__createTryRenderContentPreset: factory } = await import(moduleUrl);
    const cases = [
        ['onCommitted 异常', {}, { onCommitted: () => { throw new Error('observer'); } }],
        ['订阅注册异常', { subscribeTableUpdate: () => { throw new Error('subscribe'); } }, {}],
        ['滚动恢复异常', { contentPresetScrollRegistry: { write: () => {}, restore: () => { throw new Error('restore'); } } }, {}],
    ];
    for (const [name, overrides, options] of cases) {
        const { result, rootState } = await renderCase(factory, overrides, options);
        assert.equal(result, true, `${name} 后 committed renderer 必须保持成功`);
        assert.equal(rootState.commitCalls, 1, `${name} 不得重复 commit`);
        assert.equal(rootState.fallbackCalls, 0, `${name} 不得回退原 renderer`);
        assert.equal(rootState.root?.removed, false, `${name} 不得销毁已提交 root`);
    }

    for (const [name, overrides] of [
        ['import reject', { importContentPresetModule: async () => { throw new Error('import'); } }],
        ['mount throw', { invokeContentPresetMount: async () => { throw new Error('mount'); } }],
        ['mount reject', { invokeContentPresetMount: () => Promise.reject(new Error('mount reject')) }],
        ['mount timeout', { invokeContentPresetMount: async () => { throw new Error('玉子美化模块接入超时'); } }],
    ]) {
        const { result, rootState } = await renderCase(factory, overrides);
        assert.equal(result, true, `${name} 后必须精确回退`);
        assert.equal(rootState.fallbackCalls, 1, `${name} 只能回退一次`);
        assert.equal(rootState.commitCalls, 0, `${name} 不得 commit`);
        assert.equal(rootState.root?.removed, true, `${name} 必须移除候选 root`);
    }

    const failedMount = await renderCase(factory, { invokeContentPresetMount: async () => { throw new Error('mount cleanup'); } });
    assert.equal(failedMount.rootState.assetDisposeCalls, 1, '提交前失败必须释放 asset runtime');
    assert.equal(failedMount.rootState.presetAssetsDisposeCalls, 1, '提交前失败必须释放 preset assets runtime');
    assert.equal(failedMount.rootState.moduleDisposeCalls, 1, '提交前失败必须释放 module URL');
    assert.equal(failedMount.rootState.releaseCalls, 1, '提交前失败必须释放 viewing sheet lease');
    assert.equal(failedMount.rootState.contextDisposeCalls >= 1, true, '提交前失败必须停止 context');

    const committed = await renderCase(factory);
    const committedRoot = committed.rootState.root;
    assert.equal(committed.rootState.importCalls, 1);
    assert.equal(committed.rootState.mountCalls, 1);
    assert.deepEqual(committed.rootState.presetAssetsCreateArgs, ['preset-a']);
    assert.strictEqual(committed.rootState.contextOptions.presetAssets, committed.rootState.presetAssets, 'mount context 必须注入当前预设图片 API');
    assert.equal(committed.rootState.scrollRestoreCalls.length, 1, 'commit 后必须注册滚动恢复');
    committed.rootState.updateCallback();
    assert.strictEqual(committed.rootState.root, committedRoot, '表更新不得替换 root');
    assert.equal(committed.rootState.importCalls, 1, '表更新不得重新 import');
    assert.equal(committed.rootState.mountCalls, 1, '表更新不得重新 mount');
    assert.equal(committed.rootState.publishCalls.length, 1, '表更新只发布一次新快照');
    assert.equal(committed.rootState.publishCalls[0].version, 1);
    committedRoot.scrollTop = 240;
    committed.rootState.instance.dispose();
    assert.equal(committed.rootState.scrollWrites.length, 1, 'dispose 必须捕获已提交 root 滚动');
    assert.equal(committed.rootState.scrollWrites[0][1], 240);
    assert.equal(committed.rootState.scrollCancelCalls, 1, 'dispose 必须取消滚动恢复');
    assert.equal(committed.rootState.assetDisposeCalls, 1);
    assert.equal(committed.rootState.presetAssetsDisposeCalls, 1);
    assert.equal(committed.rootState.moduleDisposeCalls, 1);
    assert.equal(committed.rootState.releaseCalls, 1);
    assert.equal(committedRoot.removed, true);

    console.log('[content-presets-renderer-behavior-check] 检查通过');
}

main().catch(error => { console.error('[content-presets-renderer-behavior-check] 检查失败：', error); process.exitCode = 1; });
