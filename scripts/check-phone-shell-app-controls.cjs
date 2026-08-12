const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

class FakeElement {
    constructor(classNames = [], ownerDocument = null) {
        this.hidden = false;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.classList = {
            values: new Set(classNames),
            add: (...names) => names.forEach((name) => this.classList.values.add(name)),
            contains: (name) => this.classList.values.has(name),
            remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        };
        this.computedStyle = {
            background: '',
            backgroundColor: 'transparent',
            backgroundImage: 'none',
            display: 'block',
            pointerEvents: 'auto',
            visibility: 'visible',
        };
        this.listeners = new Map();
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.parentElement = null;
        this.style = {
            values: new Map(),
            removeProperty: (name) => this.style.values.delete(name),
            setProperty: (name, value) => this.style.values.set(name, value),
        };
    }

    appendChild(child) {
        child.parentNode = this;
        child.parentElement = this;
        child.ownerDocument ||= this.ownerDocument;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        child.parentElement = null;
        return child;
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value = '') {
        this.attributes.set(name, String(value));
    }

    matches(selector) {
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const attrMatch = selector.match(/^\[([^\]]+)\]$/);
        return attrMatch ? this.attributes.has(attrMatch[1]) : false;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        for (const child of this.children) {
            if (child.matches(selector)) matches.push(child);
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    dispatch(type) {
        this.listeners.get(type)?.({ preventDefault() {} });
    }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        FakeMutationObserver.instances.push(this);
    }

    observe() {}

    disconnect() {
        this.disconnected = true;
    }

    trigger() {
        this.callback([]);
    }
}
FakeMutationObserver.instances = [];

async function main() {
    const controls = await import(toModuleUrl('modules/phone-core/shell-app-controls.js'));
    const layers = await import(toModuleUrl('modules/phone-core/shell-temporary-layer-host.js'));
    const shellUi = await import(toModuleUrl('modules/phone-core/shell-ui.js'));
    const listTemplates = await import(toModuleUrl('modules/table-viewer/list-page-template.js'));
    const detailTemplates = await import(toModuleUrl('modules/table-viewer/detail-page-template.js'));
    const variableTemplates = await import(toModuleUrl('modules/variable-manager/templates.js'));

    const shellHtml = shellUi.buildPhoneShellHtml();
    assert.equal((shellHtml.match(/phone-status-bar/g) || []).length, 1, '手机壳只渲染一套状态栏');
    assert.match(shellHtml, /data-phone-home-indicator/, '手机壳提供全局 Home Indicator');
    assert.match(shellHtml, /data-phone-temporary-layer-host/, '手机壳提供全局临时层宿主');

    assert.match(listTemplates.buildGenericListBottomBarHtml(), /data-phone-bottom-bar/, '通用列表底栏声明共享底栏契约');
    assert.match(detailTemplates.buildGenericDetailPageHtml({
        genericStylePayload: { className: '', dataAttrs: '', styleAttr: '', templateId: '' },
        state: {},
    }), /data-phone-bottom-bar/, '通用详情底栏声明共享底栏契约');
    assert.equal((variableTemplates.buildVariableManagerPageHtml(-1, false).match(/data-phone-bottom-bar/g) || []).length, 2, '变量管理器两种底栏都声明共享底栏契约');

    const shellCss = fs.readFileSync(path.join(ROOT, 'styles/phone-base/01-shell-system.css'), 'utf8');
    const variableCss = fs.readFileSync(path.join(ROOT, 'styles/12-variable-manager.css'), 'utf8');
    assert.match(shellCss, /data-phone-home-indicator-layout="docked"[^}]+\.phone-screen[^{]*\{[^}]*margin-bottom:/s, '停靠模式为 Home 区域缩短当前页面');
    assert.match(shellCss, /data-phone-home-indicator-layout="docked"[^}]+\.phone-home-indicator[^{]*\{[^}]*background:/s, '停靠模式提供独立 Home 区域背景');
    assert.match(variableCss, /\.vm-footer,\s*\.vm-delete-bar\s*\{[^}]*background:\s*var\(--vm-surface-strong\);/s,
        '变量管理器底栏使用可独立绘制的强表面，复制到 Home 区域后不得透出外壳底色');

    const windowListeners = new Map();
    const fakeWindow = {
        MutationObserver: FakeMutationObserver,
        addEventListener(type, listener) {
            windowListeners.set(type, listener);
        },
        getComputedStyle(element) {
            return element.computedStyle;
        },
        removeEventListener(type, listener) {
            if (windowListeners.get(type) === listener) windowListeners.delete(type);
        },
    };
    const ownerDocument = { defaultView: fakeWindow };
    const root = new FakeElement([], ownerDocument);
    const shell = root.appendChild(new FakeElement(['phone-shell'], ownerDocument));
    const screen = shell.appendChild(new FakeElement(['phone-screen'], ownerDocument));
    const temporaryLayerHost = shell.appendChild(new FakeElement([], ownerDocument));
    temporaryLayerHost.setAttribute('data-phone-temporary-layer-host', '');
    const indicator = shell.appendChild(new FakeElement(['phone-home-indicator'], ownerDocument));
    indicator.setAttribute('data-phone-home-indicator', '');

    let route = 'home';
    const navigations = [];
    const controller = controls.bindPhoneShellAppControls(root, {
        getCurrentRoute: () => route,
        navigateTo: (nextRoute) => navigations.push(nextRoute),
    });

    assert.equal(indicator.hidden, true, '主页不显示 Home Indicator');

    route = 'qq';
    controller.refresh();
    assert.equal(indicator.hidden, false, '非主页显示 Home Indicator');
    assert.equal(shell.getAttribute('data-phone-home-indicator-layout'), 'floating', '无底栏页面保留悬浮 Home Indicator');

    const pageWithBar = screen.appendChild(new FakeElement(['phone-page'], ownerDocument));
    const bottomBar = pageWithBar.appendChild(new FakeElement([], ownerDocument));
    bottomBar.setAttribute('data-phone-bottom-bar', '');
    bottomBar.computedStyle.backgroundColor = 'rgb(245, 245, 245)';
    FakeMutationObserver.instances.at(-1).trigger();
    assert.equal(shell.getAttribute('data-phone-home-indicator-layout'), 'docked', '当前页存在可见底栏时 Home Indicator 自动停靠');
    assert.equal(shell.style.values.get('--yuzi-phone-home-region-background'), 'rgb(245, 245, 245)', 'Home 区域自动继承当前底栏背景');

    bottomBar.computedStyle.pointerEvents = 'none';
    FakeMutationObserver.instances.at(-1).trigger();
    assert.equal(shell.getAttribute('data-phone-home-indicator-layout'), 'floating', '隐藏底栏不触发停靠');

    bottomBar.computedStyle.pointerEvents = 'auto';
    const pageWithoutBar = screen.appendChild(new FakeElement(['phone-page'], ownerDocument));
    FakeMutationObserver.instances.at(-1).trigger();
    assert.equal(shell.getAttribute('data-phone-home-indicator-layout'), 'floating', '只检测当前活动页面，不读取历史页面底栏');

    screen.removeChild(pageWithoutBar);
    FakeMutationObserver.instances.at(-1).trigger();
    assert.equal(shell.getAttribute('data-phone-home-indicator-layout'), 'docked', '返回带底栏页面后自动恢复停靠');

    indicator.dispatch('click');
    assert.deepEqual(navigations, ['home'], 'Home Indicator 只请求回到主页');

    let closed = 0;
    const layer = new FakeElement();
    const disposeLayer = layers.mountPhoneTemporaryLayer(layer, () => {
        closed += 1;
    });
    assert.equal(temporaryLayerHost.children.length, 1, '临时层挂载到手机壳宿主');

    layers.clearPhoneTemporaryLayers();
    assert.equal(closed, 1, '清理临时层时调用关闭回调');
    assert.equal(temporaryLayerHost.children.length, 0, '清理临时层时移除手机壳宿主内容');

    disposeLayer();
    controller.dispose();
    assert.equal(FakeMutationObserver.instances[0].disconnected, true, '销毁外壳控制器时停止底栏观察');
    assert.equal(windowListeners.has('resize'), false, '销毁外壳控制器时移除尺寸监听');
    layers.resetPhoneTemporaryLayerHost();

    const firstController = controls.bindPhoneShellAppControls(root, {
        getCurrentRoute: () => route,
        navigateTo: (nextRoute) => navigations.push(nextRoute),
    });
    const replacementController = controls.bindPhoneShellAppControls(root, {
        getCurrentRoute: () => route,
        navigateTo: (nextRoute) => navigations.push(nextRoute),
    });
    const replacementLayer = new FakeElement();
    let replacementClosed = 0;
    layers.mountPhoneTemporaryLayer(replacementLayer, () => {
        replacementClosed += 1;
    });

    firstController.dispose();
    assert.equal(layers.getPhoneTemporaryLayerHost(), temporaryLayerHost, '旧控制器释放时不能清掉新一轮外壳注册');
    assert.equal(temporaryLayerHost.children.length, 1, '旧控制器释放时保留新一轮临时层');
    assert.equal(replacementClosed, 0, '旧控制器不触发新一轮临时层关闭回调');

    replacementController.dispose();
    assert.equal(layers.getPhoneTemporaryLayerHost(), null, '当前控制器释放时重置临时层宿主');
    assert.equal(temporaryLayerHost.children.length, 0, '当前控制器释放时清理临时层节点');
    assert.equal(replacementClosed, 1, '当前控制器释放时触发临时层关闭回调');

    console.log('[phone-shell-app-controls-check] 检查通过');
}

main().catch((error) => {
    console.error('[phone-shell-app-controls-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
