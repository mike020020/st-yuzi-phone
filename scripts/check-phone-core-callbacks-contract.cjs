const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();

const FILES = {
    callbacks: 'modules/phone-core/callbacks.js',
    lifecycle: 'modules/phone-core/lifecycle.js',
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

function extractFunction(source, startNeedle, nextNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(nextNeedle, start);
    if (start < 0 || end < 0) return '';
    return source.slice(start, end);
}

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

async function checkSubscribeTableUpdateBehavior() {
    const previousWindow = global.window;
    const fakeWindow = {};
    fakeWindow.parent = fakeWindow;
    global.window = fakeWindow;

    let callbacks = null;
    let stateModule = null;

    try {
        callbacks = await import(`${toModuleUrl(FILES.callbacks)}?behavior=${Date.now()}`);
        stateModule = await import(toModuleUrl('modules/phone-core/state.js'));
        callbacks.unregisterTableUpdateListener();
        stateModule.resetPhoneCoreState();

        assert.strictEqual(
            callbacks.subscribeTableUpdate(null),
            null,
            '非函数 callback 必须返回 null',
        );

        let missingCallbackCalls = 0;
        const missingCallback = () => { missingCallbackCalls += 1; };
        fakeWindow.AutoCardUpdaterAPI = null;
        assert.strictEqual(
            callbacks.subscribeTableUpdate(missingCallback),
            null,
            '底层 API 缺失时必须返回 null',
        );
        assert.strictEqual(
            stateModule.getPhoneCoreState().registeredTableUpdateCallback,
            null,
            '底层 API 缺失时不得残留 native callback 状态',
        );

        let throwingCallbackCalls = 0;
        let rejectedNativeCallback = null;
        const throwingCallback = () => { throwingCallbackCalls += 1; };
        fakeWindow.AutoCardUpdaterAPI = {
            registerTableUpdateCallback(nativeCallback) {
                rejectedNativeCallback = nativeCallback;
                throw new Error('register failed');
            },
        };
        assert.strictEqual(
            callbacks.subscribeTableUpdate(throwingCallback),
            null,
            '底层注册抛错时必须返回 null',
        );
        assert.strictEqual(typeof rejectedNativeCallback, 'function', '抛错路径应实际尝试注册 native callback');
        assert.strictEqual(
            stateModule.getPhoneCoreState().registeredTableUpdateCallback,
            null,
            '底层注册抛错后必须回滚 native callback 状态',
        );
        rejectedNativeCallback({ phase: 'rejected' });
        assert.strictEqual(throwingCallbackCalls, 0, '注册失败的 subscriber 必须立即从内部 Set 回滚');

        let successfulNativeCallback = null;
        let unregisteredNativeCallback = null;
        let registerCalls = 0;
        let unregisterCalls = 0;
        fakeWindow.AutoCardUpdaterAPI = {
            registerTableUpdateCallback(nativeCallback) {
                registerCalls += 1;
                successfulNativeCallback = nativeCallback;
            },
            unregisterTableUpdateCallback(nativeCallback) {
                unregisterCalls += 1;
                unregisteredNativeCallback = nativeCallback;
            },
        };

        const receivedByFirst = [];
        const receivedBySecond = [];
        const firstDisposer = callbacks.subscribeTableUpdate((payload) => {
            receivedByFirst.push(payload);
        });
        const secondDisposer = callbacks.subscribeTableUpdate((payload) => {
            receivedBySecond.push(payload);
        });
        assert.strictEqual(typeof firstDisposer, 'function', '第一个有效 subscriber 必须返回真实 disposer');
        assert.strictEqual(typeof secondDisposer, 'function', '第二个有效 subscriber 必须返回真实 disposer');
        assert.strictEqual(registerCalls, 1, '两个 subscriber 必须共享一次底层 native 注册');
        assert.strictEqual(typeof successfulNativeCallback, 'function', '恢复 API 后必须重新注册 native callback');
        assert.strictEqual(
            stateModule.getPhoneCoreState().registeredTableUpdateCallback,
            successfulNativeCallback,
            '成功注册后 state 必须持有当前 native callback',
        );

        const sharedPayload = { phase: 'success' };
        successfulNativeCallback(sharedPayload);
        assert.deepStrictEqual(receivedByFirst, [sharedPayload], '单次 native 通知必须向第一个 subscriber 分发一次');
        assert.deepStrictEqual(receivedBySecond, [sharedPayload], '单次 native 通知必须向第二个 subscriber 分发一次');
        assert.strictEqual(missingCallbackCalls, 0, 'API 缺失时失败的 subscriber 不得残留');
        assert.strictEqual(throwingCallbackCalls, 0, '注册抛错时失败的 subscriber 不得残留');

        const afterFirstDisposePayload = { phase: 'after-first-dispose' };
        firstDisposer();
        successfulNativeCallback(afterFirstDisposePayload);
        assert.deepStrictEqual(receivedByFirst, [sharedPayload], '第一个 disposer 后对应 subscriber 不得继续接收通知');
        assert.deepStrictEqual(
            receivedBySecond,
            [sharedPayload, afterFirstDisposePayload],
            '第一个 disposer 后第二个 subscriber 必须继续接收通知',
        );

        secondDisposer();
        successfulNativeCallback({ phase: 'after-second-dispose' });
        assert.deepStrictEqual(receivedByFirst, [sharedPayload], '两个 disposer 完成后第一个 subscriber 必须保持移除');
        assert.deepStrictEqual(
            receivedBySecond,
            [sharedPayload, afterFirstDisposePayload],
            '两个 disposer 完成后第二个 subscriber 不得继续接收通知',
        );
        assert.strictEqual(unregisterCalls, 0, 'subscriber disposer 只移除上层订阅，不得提前注销共享 native callback');

        callbacks.unregisterTableUpdateListener();
        assert.strictEqual(unregisterCalls, 1, '最终清理必须注销底层 native callback 一次');
        assert.strictEqual(
            unregisteredNativeCallback,
            successfulNativeCallback,
            '注销时必须传回成功注册的同一个 native callback',
        );
        assert.strictEqual(
            stateModule.getPhoneCoreState().registeredTableUpdateCallback,
            null,
            '注销后必须清空 native callback 状态',
        );
    } finally {
        callbacks?.unregisterTableUpdateListener();
        stateModule?.resetPhoneCoreState();
        if (previousWindow === undefined) {
            delete global.window;
        } else {
            global.window = previousWindow;
        }
    }
}

async function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];
    const subscribeTableUpdate = extractFunction(
        contents.callbacks,
        'export function subscribeTableUpdate(callback)',
        'export function registerTableUpdateListener(callback)',
    );

    check(results, 'callbacks', 'callbacks 使用 scoped logger', has(contents.callbacks, "const logger = Logger.withScope({ scope: 'phone-core/callbacks', feature: 'callbacks' });"));
    check(results, 'callbacks', 'callbacks 新增 shouldSkipSmartRefresh()', has(contents.callbacks, 'function shouldSkipSmartRefresh('));
    check(results, 'callbacks', 'callbacks 新增 dispatchSmartRefreshEvent()', has(contents.callbacks, 'function dispatchSmartRefreshEvent('));
    check(results, 'callbacks', 'registerTableUpdateListener() 使用结构化注册日志', has(contents.callbacks, "action: 'table-update.register'"));
    check(results, 'callbacks', 'unregisterTableUpdateListener() 使用结构化注销日志', has(contents.callbacks, "action: 'table-update.unregister'"));
    check(results, 'callbacks', 'registerTableFillStartListener() 使用结构化注册日志', has(contents.callbacks, "action: 'table-fill-start.register'"));
    check(results, 'callbacks', 'unregisterTableFillStartListener() 使用结构化注销日志', has(contents.callbacks, "action: 'table-fill-start.unregister'"));
    check(results, 'callbacks', 'initSmartRefreshListener() 输出 setup 日志', has(contents.callbacks, "action: 'smart-refresh.setup'"));
    check(results, 'callbacks', 'smart refresh 输出 skip 日志', has(contents.callbacks, "action: 'smart-refresh.skip'"));
    check(results, 'callbacks', 'smart refresh 输出 dispatch 日志', has(contents.callbacks, "action: 'smart-refresh.dispatch'"));
    check(results, 'callbacks', 'subscribeTableUpdate() 失败路径返回 null', has(subscribeTableUpdate, 'return null;'));
    check(results, 'callbacks', 'subscribeTableUpdate() 禁止返回假 disposer', !has(subscribeTableUpdate, 'return () => {};'));

    check(results, 'lifecycle', 'lifecycle 继续导入 initSmartRefreshListener()', has(contents.lifecycle, 'initSmartRefreshListener'));
    check(results, 'lifecycle', 'lifecycle 继续在 initPhoneUI() 接线 smart refresh', has(contents.lifecycle, 'initSmartRefreshListener();'));

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[phone-core-callbacks-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    await checkSubscribeTableUpdateBehavior();

    console.log('[phone-core-callbacks-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
    console.log(`- OK | ${FILES.callbacks} | subscribeTableUpdate() 失败回滚与成功订阅行为`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
