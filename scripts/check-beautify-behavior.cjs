const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const url = file => pathToFileURL(path.join(process.cwd(), file)).href;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

class FakeElement {
    constructor(action = 'delete') {
        this.dataset = { action, presetId: 'fixture.preset' };
        this.disabled = false;
        this.isConnected = true;
    }
    closest(selector) {
        if (selector === '.phone-nav-back') return null;
        if (selector === '[data-action]') return this;
        return null;
    }
}
class FakeButton extends FakeElement {}
global.Element = FakeElement;
global.HTMLButtonElement = FakeButton;

async function main() {
    const { createBeautifyPageBehavior } = await import(url('modules/settings-app/pages/beautify-behavior.js'));

    function createHarness(deleteImpl) {
        let listener = null;
        let confirmCallback = null;
        let deleteCalls = 0;
        let changedCalls = 0;
        const toasts = [];
        const button = new FakeButton();
        const runtime = { disposed: false, isDisposed() { return this.disposed; } };
        const container = {
            addEventListener(type, handler) { assert.equal(type, 'click'); listener = handler; },
            removeEventListener(type, handler) { assert.equal(type, 'click'); if (listener === handler) listener = null; },
        };
        const behavior = createBeautifyPageBehavior({
            container, runtime, onChanged() { changedCalls += 1; },
        }, {
            contentPresetWorkshopService: {
                deletePreset(id) { deleteCalls += 1; assert.equal(id, 'fixture.preset'); return deleteImpl(deleteCalls); },
            },
            showConfirmDialog(_container, title, message, callback, confirmText, cancelText, passedRuntime) {
                assert.equal(title, '删除完整预设？');
                assert.match(message, /原子清除/);
                assert.equal(confirmText, '确认删除');
                assert.equal(cancelText, '取消');
                assert.equal(passedRuntime, runtime);
                confirmCallback = callback;
            },
            showToast(_container, message, isError, passedRuntime) { toasts.push({ message, isError, passedRuntime }); },
        });
        const cleanup = behavior.attachPageInteractions();
        return {
            button, runtime, toasts,
            click() { listener?.({ target: button }); },
            confirm() { return confirmCallback?.(); },
            cleanup,
            get deleteCalls() { return deleteCalls; },
            get changedCalls() { return changedCalls; },
            get hasConfirm() { return typeof confirmCallback === 'function'; },
        };
    }


    {
        const h = createHarness(() => undefined);
        h.click();
        assert.equal(h.hasConfirm, true);
        assert.equal(h.deleteCalls, 0, '未确认不得删除预设');
        assert.equal(h.toasts.length, 0);
    }

    {
        const pending = deferred();
        const h = createHarness(() => pending.promise);
        h.click();
        const first = h.confirm();
        const duplicate = h.confirm();
        assert.equal(h.button.disabled, true);
        assert.equal(h.deleteCalls, 1, 'pending 期间重复确认必须被 busy 锁阻止');
        pending.resolve();
        await Promise.all([first, duplicate]);
        assert.equal(h.button.disabled, false);
        assert.equal(h.changedCalls, 1);
        assert.deepEqual(h.toasts.at(-1), { message: '预设已删除', isError: false, passedRuntime: h.runtime });
    }

    {
        const h = createHarness(call => {
            if (call === 1) throw new Error('fixture delete failure');
        });
        h.click();
        await h.confirm();
        assert.equal(h.button.disabled, false);
        assert.equal(h.changedCalls, 0);
        assert.equal(h.toasts.at(-1).isError, true);
        assert.match(h.toasts.at(-1).message, /fixture delete failure/);
        h.click();
        await h.confirm();
        assert.equal(h.deleteCalls, 2, '异常后必须释放 busy 锁并允许重试');
        assert.equal(h.changedCalls, 1);
    }

    {
        const pending = deferred();
        const h = createHarness(() => pending.promise);
        h.click();
        const completion = h.confirm();
        h.runtime.disposed = true;
        pending.resolve();
        await completion;
        assert.equal(h.toasts.length, 0, '页面销毁后不得显示完成 toast');
        assert.equal(h.changedCalls, 0, '页面销毁后不得刷新页面');
        assert.equal(h.button.disabled, false);
    }

    {
        const h = createHarness(() => undefined);
        h.cleanup();
        h.click();
        assert.equal(h.hasConfirm, false, 'cleanup 后旧 listener 不得生效');
        assert.equal(h.deleteCalls, 0);
    }

    const { buildBeautifyTemplatePageHtml } = await import(url('modules/settings-app/layout/page-builders/editor-builders.js'));
    const html = buildBeautifyTemplatePageHtml({
        status: 'ready',
        error: null,
        presets: [{ id: 'fixture.preset', name: 'Fixture', version: '1', author: 'test', items: [{ id: 'fixture.item' }], issues: [] }],
        tables: [{
            sheetKey: 'fixture.sheet', tableName: '角色表', headers: ['姓名'],
            active: { presetId: 'fixture.preset', itemId: 'fixture.item' },
            candidates: [{
                presetId: 'fixture.preset', itemId: 'fixture.item',
                preset: { name: 'Fixture' }, item: { name: 'Fixture item' },
            }],
        }],
    });
    for (const action of ['import', 'export', 'delete', 'activate', 'clear', 'clear-all']) {
        assert.match(html, new RegExp(`data-action="${action}"`));
    }
    assert.match(html, /data-preset-id="fixture\.preset"/);
    assert.match(html, /data-item-id="fixture\.item"/);
    assert.match(html, /data-sheet-key="fixture\.sheet"/);
    assert.equal(html.includes('phone-beautify-restore-defaults-btn'), false);
    assert.equal(html.includes('phone-beautify-list'), false);

    console.log('[beautify-behavior-check] 检查通过');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
