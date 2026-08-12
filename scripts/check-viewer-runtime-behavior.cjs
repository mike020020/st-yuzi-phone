const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

class FakeHTMLElement {
    constructor(name = 'element') {
        this.name = name;
        this.dataset = {};
        this.style = {};
        this.nodes = new Map();
        this.isConnected = true;
        this.parentElement = null;
    }

    querySelector(selector) {
        return this.nodes.get(selector) || null;
    }

    querySelectorAll() {
        return [];
    }

    setQuery(selector, value) {
        this.nodes.set(selector, value);
        return value;
    }

    contains(target) {
        return target === this;
    }

    addEventListener() {}

    removeEventListener() {}
}

function installDomGlobals(order = []) {
    global.HTMLElement = FakeHTMLElement;
    global.Element = FakeHTMLElement;
    global.requestAnimationFrame = (callback) => {
        if (typeof callback === 'function') callback(Date.now());
        return 1;
    };
    global.cancelAnimationFrame = () => {};

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.target = null;
            this.options = null;
        }

        observe(target, options = {}) {
            this.target = target;
            this.options = options;
            order.push(`observe:${target?.name || 'unknown'}`);
        }

        disconnect() {
            order.push('observer-disconnect');
        }
    }

    global.MutationObserver = FakeMutationObserver;
    const body = new FakeHTMLElement('body');
    const windowTarget = {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        setTimeout: global.setTimeout.bind(global),
        clearTimeout: global.clearTimeout.bind(global),
        requestAnimationFrame: global.requestAnimationFrame,
        cancelAnimationFrame: global.cancelAnimationFrame,
    };
    global.window = windowTarget;
    global.document = {
        body,
        getElementById() {
            return null;
        },
    };
    return { body, windowTarget };
}

async function importViewerModules() {
    const runtimeModule = await import(toModuleUrl('modules/table-viewer/runtime.js'));
    const genericRuntimeModule = await import(toModuleUrl('modules/table-viewer/generic-runtime.js'));
    const callbacksModule = await import(toModuleUrl('modules/phone-core/callbacks.js'));
    return { runtimeModule, genericRuntimeModule, callbacksModule };
}

async function testViewerRuntimeStartSession(runtimeModule) {
    const order = [];
    installDomGlobals(order);
    const container = new FakeHTMLElement('viewer-container');
    const observerRoot = new FakeHTMLElement('body');
    const runtime = runtimeModule.createViewerRuntime({
        container,
        sheetKey: 'sheet_runtime',
        rerenderViewer: () => {},
        runtimeDeps: {
            getModalById: () => null,
            acquireCurrentViewingSheet: (sheetKey) => {
                order.push(`acquire:${sheetKey}`);
                return { sheetKey };
            },
            releaseCurrentViewingSheet: (owner) => order.push(`release:${owner.sheetKey}`),
            resetDataVersion: () => order.push('reset'),
            bindTemplateDraftPreviewForViewer: (host, sheetKey) => {
                order.push(`draft:${sheetKey}`);
                host.__yuziDraftPreviewCleanup = () => order.push('draft-cleanup');
            },
            getObserverRoot: () => observerRoot,
        },
    });

    assert.ok(runtime);
    assert.equal(runtime.startViewerSession(), true);
    assert.deepEqual(order.slice(0, 4), [
        'acquire:sheet_runtime',
        'reset',
        'draft:sheet_runtime',
        'observe:body',
    ]);

    runtime.dispose();
    assert.ok(order.includes('draft-cleanup'));
    assert.ok(order.includes('observer-disconnect'));
    assert.ok(order.includes('release:sheet_runtime'));
}

async function testViewingSheetLeaseRace(callbacksModule) {
    callbacksModule.setCurrentViewingSheet(null);
    const ownerA = callbacksModule.acquireCurrentViewingSheet('sheet_a');
    const ownerB = callbacksModule.acquireCurrentViewingSheet('sheet_b');
    assert.equal(callbacksModule.getCurrentViewingSheet(), 'sheet_b');
    assert.equal(callbacksModule.releaseCurrentViewingSheet(ownerA), false);
    assert.equal(callbacksModule.getCurrentViewingSheet(), 'sheet_b');
    assert.equal(callbacksModule.releaseCurrentViewingSheet(ownerB), true);
    assert.equal(callbacksModule.getCurrentViewingSheet(), null);
    assert.equal(callbacksModule.releaseCurrentViewingSheet(ownerA), false);
}

async function testViewerRuntimeSuppressDepth(runtimeModule) {
    installDomGlobals();
    const runtime = runtimeModule.createViewerRuntime({
        container: new FakeHTMLElement('viewer-container'),
        sheetKey: 'sheet_runtime',
        rerenderViewer: () => {},
    });

    assert.equal(runtime.isSuppressingExternalTableUpdate(), false);
    runtime.setSuppressExternalTableUpdate(true);
    assert.equal(runtime.isSuppressingExternalTableUpdate(), true);
    runtime.setSuppressExternalTableUpdate(true);
    assert.equal(runtime.isSuppressingExternalTableUpdate(), true);
    runtime.setSuppressExternalTableUpdate(false);
    assert.equal(runtime.isSuppressingExternalTableUpdate(), true);
    runtime.setSuppressExternalTableUpdate(false);
    assert.equal(runtime.isSuppressingExternalTableUpdate(), false);
    runtime.setSuppressExternalTableUpdate(false);
    assert.equal(runtime.isSuppressingExternalTableUpdate(), false);
}

async function testGenericRuntimeStartOrder(genericRuntimeModule) {
    const order = [];
    const container = new FakeHTMLElement('generic-container');
    const viewerRuntime = {
        addRowModalId: 'modal-generic',
        bindExternalTableUpdate() {
            order.push('bind');
        },
        setSuppressExternalTableUpdate() {},
    };
    const runtime = genericRuntimeModule.createGenericTableViewerRuntime(
        container,
        {
            sheetKey: 'sheet_generic',
            tableName: 'Generic table',
            headers: [],
            rawHeaders: [],
            rows: [],
            genericMatch: null,
        },
        {
            viewerRuntime,
            renderListPage: () => order.push('render'),
        },
    );

    assert.ok(runtime);
    assert.equal(runtime.start(), true);
    assert.deepEqual(order, ['bind', 'render']);
}

async function main() {
    installDomGlobals();
    const { runtimeModule, genericRuntimeModule, callbacksModule } = await importViewerModules();

    await testViewerRuntimeStartSession(runtimeModule);
    await testViewingSheetLeaseRace(callbacksModule);
    await testViewerRuntimeSuppressDepth(runtimeModule);
    await testGenericRuntimeStartOrder(genericRuntimeModule);

    console.log('[viewer-runtime-behavior-check] passed');
    console.log('- viewer session startup and cleanup order');
    console.log('- viewing sheet lease ownership');
    console.log('- external update suppression depth');
    console.log('- generic runtime bind then render order');
}

main().catch((error) => {
    console.error('[viewer-runtime-behavior-check] failed:');
    console.error(error);
    process.exitCode = 1;
});
