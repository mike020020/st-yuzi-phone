const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const url = file => pathToFileURL(path.join(ROOT, file)).href;

class FakeElement {
    constructor() { this.disabled = false; this.isConnected = true; }
    closest(selector) {
        if (selector === '.phone-nav-back') return null;
        if (selector === '#phone-beautify-restore-defaults-btn') return this;
        return null;
    }
}
class FakeButton extends FakeElement {}
global.Element = FakeElement;
global.HTMLButtonElement = FakeButton;

function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function main() {
    const { createBeautifyPageBehavior } = await import(url('modules/settings-app/pages/beautify-behavior.js'));

    function createHarness(restoreImpl) {
        let listener = null;
        let listenerActive = true;
        let confirmCallback = null;
        let confirmCalls = 0;
        let restoreCalls = 0;
        const toasts = [];
        const button = new FakeButton();
        const runtime = {
            disposed: false,
            isDisposed() { return this.disposed; },
            addEventListener(_target, type, handler) {
                assert.equal(type, 'click');
                listener = handler;
                return () => { listenerActive = false; };
            },
        };
        const behavior = createBeautifyPageBehavior({
            container: {}, ctx: { state: { mode: 'beautify' }, render() {} }, runtime,
        }, {
            showConfirmDialog(_container, title, message, callback, confirmText, cancelText, passedRuntime) {
                assert.equal(typeof title, 'string');
                assert.equal(typeof message, 'string');
                assert.equal(typeof confirmText, 'string');
                assert.equal(typeof cancelText, 'string');
                assert.equal(passedRuntime, runtime);
                confirmCalls += 1;
                confirmCallback = callback;
            },
            showToast(_container, message, isError, passedRuntime) {
                toasts.push({ message, isError, passedRuntime });
            },
            restorePhoneBeautifyTemplatesToBuiltinDefaults() {
                restoreCalls += 1;
                return restoreImpl(restoreCalls);
            },
        });
        const cleanup = behavior.attachPageInteractions();
        return {
            button, runtime, toasts, cleanup,
            click() { if (listenerActive) listener({ target: button }); },
            confirm() { return confirmCallback?.(); },
            get confirmCallback() { return confirmCallback; },
            get confirmCalls() { return confirmCalls; },
            get restoreCalls() { return restoreCalls; },
        };
    }

    {
        const h = createHarness(() => ({ success: true }));
        h.click();
        assert.equal(h.confirmCalls, 1);
        assert.equal(h.restoreCalls, 0, '未确认即取消时不得执行恢复');
        assert.equal(h.toasts.length, 0);
        assert.equal(h.button.disabled, false);
    }

    {
        const pending = deferred();
        const h = createHarness(() => pending.promise);
        h.click();
        const first = h.confirm();
        h.confirm();
        assert.equal(h.button.disabled, true);
        assert.equal(h.restoreCalls, 1, 'pending 期间重复确认必须被并发锁阻止');
        pending.resolve({ success: true });
        await first;
        assert.equal(h.button.disabled, false);
        assert.deepEqual(h.toasts.at(-1), { message: '已恢复默认', isError: false, passedRuntime: h.runtime });
    }

    {
        const h = createHarness(call => call === 1
            ? { success: false, message: 'fixture business failure' }
            : { success: true });
        h.click();
        await h.confirm();
        assert.equal(h.button.disabled, false);
        assert.equal(h.toasts.at(-1).isError, true);
        assert.equal(h.toasts.at(-1).message, 'fixture business failure');
        h.click();
        await h.confirm();
        assert.equal(h.restoreCalls, 2, '业务失败后必须允许重试');
        assert.equal(h.toasts.at(-1).isError, false);
    }

    {
        const h = createHarness(call => {
            if (call === 1) throw new Error('fixture throw');
            return { success: true };
        });
        h.click();
        await h.confirm();
        assert.equal(h.button.disabled, false);
        assert.equal(h.toasts.at(-1).isError, true);
        assert.match(h.toasts.at(-1).message, /fixture throw/);
        h.click();
        await h.confirm();
        assert.equal(h.restoreCalls, 2, '异常后必须释放锁并允许重试');
    }

    {
        const pending = deferred();
        const h = createHarness(() => pending.promise);
        h.click();
        const completion = h.confirm();
        h.runtime.disposed = true;
        pending.resolve({ success: true });
        await completion;
        assert.equal(h.toasts.length, 0, 'pending 完成前页面销毁不得显示 toast');
        assert.equal(h.button.disabled, false);
    }

    {
        const h = createHarness(() => ({ success: true }));
        h.click();
        const staleConfirm = h.confirmCallback;
        h.runtime.disposed = true;
        await staleConfirm();
        assert.equal(h.restoreCalls, 0, '页面销毁后旧 confirm callback 不得执行恢复');
        assert.equal(h.toasts.length, 0);
    }

    {
        const h = createHarness(() => ({ success: true }));
        h.cleanup();
        h.click();
        assert.equal(h.confirmCalls, 0, 'cleanup 后旧 listener 不得生效');
        assert.equal(h.restoreCalls, 0);
    }

    const { buildBeautifyTemplatePageHtml } = await import(url('modules/settings-app/layout/page-builders/editor-builders.js'));
    const html = buildBeautifyTemplatePageHtml();
    assert.match(html, /id="phone-beautify-restore-defaults-btn"/);
    for (const obsolete of ['type="file"', 'phone-beautify-list', 'phone-beautify-import', 'phone-beautify-export', '暂无专属小剧场模板']) {
        assert.equal(html.includes(obsolete), false, `页面不得保留旧管理结构：${obsolete}`);
    }

    await tick();
    console.log('[beautify-behavior-check] 检查通过');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
