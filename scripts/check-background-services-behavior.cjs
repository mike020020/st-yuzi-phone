const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeClock {
    constructor() {
        this.now = 0;
        this.nextId = 1;
        this.tasks = new Map();
    }

    setTimeout(callback, delay) {
        const id = this.nextId;
        this.nextId += 1;
        this.tasks.set(id, { at: this.now + delay, callback });
        return id;
    }

    clearTimeout(id) {
        this.tasks.delete(id);
    }

    async tick(ms) {
        const target = this.now + ms;
        while (this.tasks.size > 0) {
            const next = [...this.tasks.entries()]
                .filter(([, task]) => task.at <= target)
                .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
            if (!next) break;
            this.now = next[1].at;
            this.tasks.delete(next[0]);
            next[1].callback();
            await Promise.resolve();
        }
        this.now = target;
        await Promise.resolve();
    }

    delays() {
        return [...this.tasks.values()]
            .map((task) => task.at - this.now)
            .sort((left, right) => left - right);
    }
}

function createHarness(mod, options = {}) {
    const clock = new FakeClock();
    const subscribers = new Set();
    const state = {
        chronicleStarts: 0,
        chronicleStops: 0,
        smallStarts: 0,
        smallStops: 0,
        subscriptions: 0,
        unsubscriptions: 0,
    };

    mod.__test__setPhoneBackgroundServiceDeps({
        startChronicle: () => {
            state.chronicleStarts += 1;
            return typeof options.startChronicle === 'function' ? options.startChronicle() : true;
        },
        stopChronicle: () => {
            state.chronicleStops += 1;
            return typeof options.stopChronicle === 'function' ? options.stopChronicle() : true;
        },
        startSmallCalendar: () => {
            state.smallStarts += 1;
            return typeof options.startSmallCalendar === 'function' ? options.startSmallCalendar() : true;
        },
        stopSmallCalendar: () => {
            state.smallStops += 1;
            return typeof options.stopSmallCalendar === 'function' ? options.stopSmallCalendar() : true;
        },
        subscribeTableUpdate: options.subscribeTableUpdate || ((callback) => {
            state.subscriptions += 1;
            subscribers.add(callback);
            return () => {
                if (subscribers.delete(callback)) state.unsubscriptions += 1;
            };
        }),
        setTimeout: clock.setTimeout.bind(clock),
        clearTimeout: clock.clearTimeout.bind(clock),
        logger: options.logger || { debug() {}, warn() {} },
    });

    return {
        clock,
        state,
        notify() {
            [...subscribers].forEach((callback) => callback());
        },
        captureSubscribers() {
            return [...subscribers];
        },
        subscriberCount() {
            return subscribers.size;
        },
    };
}

async function testSecondSignalAndSettle(mod) {
    const h = createHarness(mod);
    assert.strictEqual(mod.startPhoneBackgroundServices('test-enable'), true);
    assert.strictEqual(mod.startPhoneBackgroundServices('test-idempotent'), true);
    assert.strictEqual(h.state.chronicleStarts, 1, '重复 enable 不得重复启动派生器');
    assert.strictEqual(h.state.smallStarts, 1, '重复 enable 不得重复启动派生器');

    assert.strictEqual(mod.handlePhoneBackgroundChatChanged('chat-b'), true);
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false, '聊天切换必须立即停止旧聊天派生器');
    assert.deepStrictEqual(h.clock.delays(), [3500]);
    assert.strictEqual(h.subscriberCount(), 1, '等待第二信号时必须保留一个屏障 subscriber');

    h.notify();
    assert.deepStrictEqual(h.clock.delays(), [3500], '第一次 table-update 是中间态，必须继续等待');
    assert.strictEqual(h.subscriberCount(), 1, '第一次信号后屏障 subscriber 必须继续保留');
    assert.strictEqual(h.state.unsubscriptions, 0, '第一次信号不得提前调用 disposer');
    h.notify();
    assert.deepStrictEqual(h.clock.delays(), [250], '第二次 table-update 后必须稳定等待 250ms');
    assert.strictEqual(h.state.unsubscriptions, 1, '收到第二次通知后必须立即解除屏障订阅');
    assert.strictEqual(h.subscriberCount(), 0, '收到第二次通知后 subscriber Set 必须清空');

    await h.clock.tick(249);
    assert.strictEqual(h.state.chronicleStarts, 1);
    await h.clock.tick(1);
    assert.strictEqual(h.state.chronicleStarts, 2);
    assert.strictEqual(h.state.smallStarts, 2);
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), true);
    assert.strictEqual(h.state.unsubscriptions, 1, 'settle 完成不得重复调用屏障 disposer');
    assert.strictEqual(h.subscriberCount(), 0, 'settle 完成后 subscriber Set 必须保持为空');
}

async function testTimeoutFallback(mod) {
    const h = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-timeout');
    assert.strictEqual(h.subscriberCount(), 1, '3500ms fallback 等待期必须保留一个 subscriber');
    h.notify();
    await h.clock.tick(3499);
    assert.strictEqual(h.state.chronicleStarts, 1, '3.5s 前不得提前兜底');
    assert.strictEqual(h.state.unsubscriptions, 0, '3.5s 前不得释放仍在等待第二信号的 subscriber');
    assert.strictEqual(h.subscriberCount(), 1, '3.5s 前 subscriber Set 必须仍有一个成员');
    await h.clock.tick(1);
    assert.strictEqual(h.state.chronicleStarts, 2, '3.5s 未收齐通知必须恢复最新 generation');
    assert.strictEqual(h.state.smallStarts, 2);
    assert.strictEqual(h.clock.tasks.size, 0);
    assert.strictEqual(h.state.unsubscriptions, 1, '3500ms timeout 必须恰好调用一次 disposer');
    assert.strictEqual(h.subscriberCount(), 0, '3500ms timeout 后 subscriber Set 必须清空');
}

async function testContinuousChatChangesRejectOldGeneration(mod) {
    const h = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-old');
    const [oldCallback] = h.captureSubscribers();
    assert.strictEqual(h.subscriberCount(), 1, '旧聊天屏障必须建立一个 subscriber');
    oldCallback();
    oldCallback();
    assert.deepStrictEqual(h.clock.delays(), [250]);
    assert.strictEqual(h.state.unsubscriptions, 1, '旧聊天收到第二信号后必须恰好释放一次 subscriber');
    assert.strictEqual(h.subscriberCount(), 0, '旧聊天进入 settling 后 subscriber Set 必须清空');

    mod.handlePhoneBackgroundChatChanged('chat-new');
    assert.strictEqual(h.state.unsubscriptions, 1, '替换已 settling 的旧聊天不得重复调用旧 disposer');
    assert.strictEqual(h.subscriberCount(), 1, '新聊天必须建立且只保留自己的 subscriber');
    oldCallback();
    await h.clock.tick(250);
    assert.strictEqual(h.state.chronicleStarts, 1, '旧 generation 的回调和 settle timer 不得重启派生器');

    h.notify();
    h.notify();
    await h.clock.tick(250);
    assert.strictEqual(h.state.chronicleStarts, 2, '仅最新 generation 可以重启派生器');
    assert.strictEqual(h.state.smallStarts, 2);
    assert.strictEqual(h.state.unsubscriptions, 2, '连续聊天替换的两代 subscriber 必须各清理一次');
    assert.strictEqual(h.subscriberCount(), 0, '最新 generation 完成后 subscriber Set 必须清空');
}

async function testContinuousWaitingChatChangesDisposeOldGeneration(mod) {
    const h = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');

    mod.handlePhoneBackgroundChatChanged('chat-a');
    const [chatACallback] = h.captureSubscribers();
    assert.strictEqual(h.subscriberCount(), 1, 'chat-a waiting 阶段必须保留自己的 subscriber');

    mod.handlePhoneBackgroundChatChanged('chat-b');
    const [chatBCallback] = h.captureSubscribers();
    assert.strictEqual(h.state.unsubscriptions, 1, 'chat-b 替换 chat-a 时必须恰好调用一次旧 disposer');
    assert.strictEqual(h.subscriberCount(), 1, 'chat-b 建立后 Set 只能保留最新 subscriber');

    mod.handlePhoneBackgroundChatChanged('chat-c');
    assert.strictEqual(h.state.unsubscriptions, 2, 'chat-c 替换 chat-b 时必须恰好调用一次旧 disposer');
    assert.strictEqual(h.subscriberCount(), 1, '连续替换后 Set 仍只能保留 chat-c subscriber');

    chatACallback();
    chatBCallback();
    assert.strictEqual(h.state.unsubscriptions, 2, '旧 generation callback 不得触发重复 disposer');
    assert.strictEqual(h.subscriberCount(), 1, '旧 generation callback 不得移除或恢复最新 subscriber');

    h.notify();
    h.notify();
    assert.strictEqual(h.state.unsubscriptions, 3, 'chat-c 收齐第二信号后必须恰好清理自己的 subscriber');
    assert.strictEqual(h.subscriberCount(), 0, 'chat-c 进入 settling 后 subscriber Set 必须清空');
    await h.clock.tick(250);
    assert.strictEqual(h.state.chronicleStarts, 2, '连续 waiting 替换后只能由最新 generation 重启纪要派生器');
    assert.strictEqual(h.state.smallStarts, 2, '连续 waiting 替换后只能由最新 generation 重启小日历派生器');
    assert.strictEqual(h.state.unsubscriptions, 3, '最新 generation settle 完成不得重复调用 disposer');
    assert.strictEqual(h.subscriberCount(), 0, '最新 generation settle 完成后 Set 必须保持为空');
}

async function testDisableCancelsEveryBarrierPhase(mod) {
    const waiting = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-waiting');
    const [waitingCallback] = waiting.captureSubscribers();
    assert.strictEqual(waiting.subscriberCount(), 1, 'waiting 阶段必须存在一个 subscriber');
    mod.stopPhoneBackgroundServices('test-disable');
    assert.strictEqual(waiting.state.unsubscriptions, 1, 'disable waiting 阶段必须恰好调用一次 disposer');
    assert.strictEqual(waiting.subscriberCount(), 0, 'disable waiting 阶段必须清空 subscriber Set');
    waitingCallback();
    await waiting.clock.tick(5000);
    assert.strictEqual(waiting.state.chronicleStarts, 1, 'disable 后等待阶段的旧回调不得重启');
    assert.strictEqual(waiting.clock.tasks.size, 0, 'disable 必须清理 timeout');
    assert.strictEqual(waiting.state.unsubscriptions, 1, 'disable 后旧回调和旧 timeout 不得重复调用 disposer');

    const settling = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-settling');
    const [settlingCallback] = settling.captureSubscribers();
    settlingCallback();
    settlingCallback();
    assert.strictEqual(settling.state.unsubscriptions, 1, '进入 settling 时必须恰好调用一次 disposer');
    assert.strictEqual(settling.subscriberCount(), 0, '进入 settling 时 subscriber Set 必须清空');
    mod.stopPhoneBackgroundServices('test-destroy');
    await settling.clock.tick(5000);
    assert.strictEqual(settling.state.chronicleStarts, 1, 'destroy/disable 后 settle timer 不得重启');
    assert.strictEqual(settling.clock.tasks.size, 0, 'destroy/disable 必须清理 settle timer');
    assert.strictEqual(settling.state.unsubscriptions, 1, 'disable settling 阶段不得重复调用已执行的 disposer');
    assert.strictEqual(settling.subscriberCount(), 0, 'disable settling 后 subscriber Set 必须保持为空');
}

async function testDisabledChatAndSubscribeFailure(mod) {
    const disabled = createHarness(mod);
    assert.strictEqual(mod.handlePhoneBackgroundChatChanged('disabled-chat'), false);
    assert.strictEqual(disabled.state.subscriptions, 0, 'disabled 时聊天切换不得建立屏障');
    assert.strictEqual(disabled.clock.tasks.size, 0);

    const failedSubscribe = createHarness(mod, {
        subscribeTableUpdate() {
            throw new Error('subscription unavailable');
        },
    });
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-fallback');
    assert.deepStrictEqual(failedSubscribe.clock.delays(), [3500], '订阅失败仍必须保留 3.5s fallback');
    await failedSubscribe.clock.tick(3500);
    assert.strictEqual(failedSubscribe.state.chronicleStarts, 2);
    assert.strictEqual(failedSubscribe.state.smallStarts, 2);

    const nullSubscribe = createHarness(mod, {
        subscribeTableUpdate() {
            return null;
        },
    });
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-null-subscription-fallback');
    assert.deepStrictEqual(
        nullSubscribe.clock.delays(),
        [3500],
        '订阅返回 null 时只能保留 3.5s fallback',
    );
    await nullSubscribe.clock.tick(3500);
    assert.strictEqual(nullSubscribe.state.chronicleStarts, 2, 'null 订阅到点后必须恢复纪要派生器');
    assert.strictEqual(nullSubscribe.state.smallStarts, 2, 'null 订阅到点后必须恢复小日历派生器');
}

async function testPartialStartRollsBack(mod) {
    const smallFails = createHarness(mod, {
        startSmallCalendar() {
            throw new Error('small calendar start failed');
        },
    });
    assert.strictEqual(mod.startPhoneBackgroundServices('test-small-start-failure'), false);
    assert.strictEqual(smallFails.state.chronicleStarts, 1);
    assert.strictEqual(smallFails.state.smallStarts, 1);
    assert.strictEqual(smallFails.state.chronicleStops, 1, '小日历启动失败时必须回滚已启动的纪要派生器');
    assert.strictEqual(smallFails.state.smallStops, 1, '小日历即使启动抛错也必须收到幂等 stop，清理可能的部分副作用');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false);

    const chronicleFails = createHarness(mod, {
        startChronicle() {
            return false;
        },
    });
    assert.strictEqual(mod.startPhoneBackgroundServices('test-chronicle-start-failure'), false);
    assert.strictEqual(chronicleFails.state.chronicleStarts, 1);
    assert.strictEqual(chronicleFails.state.smallStarts, 1);
    assert.strictEqual(chronicleFails.state.chronicleStops, 1, '纪要返回 false 也必须收到幂等 stop，清理可能的部分副作用');
    assert.strictEqual(chronicleFails.state.smallStops, 1, '纪要启动失败时必须回滚已启动的小日历派生器');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false);
}

async function testGenerationInvalidationRollsBackBothSides(mod) {
    let reentered = false;
    const h = createHarness(mod, {
        startChronicle() {
            if (!reentered) {
                reentered = true;
                assert.strictEqual(mod.startPhoneBackgroundServices('nested-start'), true);
            }
            return true;
        },
    });

    assert.strictEqual(mod.startPhoneBackgroundServices('outer-start'), false, '旧 generation 必须拒绝完成启动');
    assert.strictEqual(h.state.chronicleStarts, 2, '重入启动应产生新旧两次纪要启动尝试');
    assert.strictEqual(h.state.smallStarts, 1, '只有最新 generation 会进入小日历启动');
    assert.strictEqual(h.state.chronicleStops, 1, '旧 generation 失效后必须停止纪要侧');
    assert.strictEqual(h.state.smallStops, 1, '旧 generation 失效后也必须停止已由重入启动的小日历侧');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false, 'generation 回滚后不得残留 running=true');
}

async function testSmallCalendarGenerationInvalidationRollsBackBothSides(mod) {
    let reentered = false;
    const h = createHarness(mod, {
        startSmallCalendar() {
            if (!reentered) {
                reentered = true;
                assert.strictEqual(mod.startPhoneBackgroundServices('nested-small-start'), true);
            }
            return true;
        },
    });

    assert.strictEqual(mod.startPhoneBackgroundServices('outer-small-start'), false, '小日历启动后失效的旧 generation 必须拒绝完成启动');
    assert.strictEqual(h.state.chronicleStarts, 2, '重入前后都应尝试启动纪要派生器');
    assert.strictEqual(h.state.smallStarts, 2, '重入前后都应尝试启动小日历派生器');
    assert.strictEqual(h.state.chronicleStops, 1, '小日历启动后 generation 失效必须停止纪要侧');
    assert.strictEqual(h.state.smallStops, 1, '小日历启动后 generation 失效必须停止小日历侧');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false, '旧 generation 回滚后不得保留重入服务的 running 状态');
}

async function testRollbackSurvivesStopAndLoggerFailures(mod) {
    const h = createHarness(mod, {
        stopSmallCalendar() {
            throw new Error('small calendar stop failed');
        },
        logger: {
            debug() {},
            warn() {
                throw new Error('logger failed');
            },
        },
    });

    assert.strictEqual(mod.startPhoneBackgroundServices('test-stop-failure'), true);
    assert.doesNotThrow(
        () => mod.stopPhoneBackgroundServices('test-stop-and-logger-failure'),
        'stop 与 logger 同时失败时不得中断双侧清理',
    );
    assert.strictEqual(h.state.smallStops, 1, '失败的小日历 stop 必须被调用一次');
    assert.strictEqual(h.state.chronicleStops, 1, 'logger 失败后仍必须继续停止纪要侧');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false);
}

async function testDebugLoggerCannotBreakLifecycle(mod) {
    const h = createHarness(mod, {
        logger: {
            debug() {
                throw new Error('debug logger failed');
            },
            warn() {},
        },
    });

    let startResult = null;
    assert.doesNotThrow(
        () => { startResult = mod.startPhoneBackgroundServices('test-debug-start'); },
        '启动成功日志抛错不得向外传播',
    );
    assert.strictEqual(startResult, true, 'debug 抛错不得把已成功启动改判为失败');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), true);

    assert.doesNotThrow(
        () => mod.stopPhoneBackgroundServices('test-debug-stop'),
        '停止成功日志抛错不得向外传播',
    );
    assert.strictEqual(h.state.smallStops, 1, 'debug 抛错时仍必须停止小日历派生器');
    assert.strictEqual(h.state.chronicleStops, 1, 'debug 抛错时仍必须停止纪要派生器');
    assert.strictEqual(mod.isPhoneBackgroundServicesStarted(), false, 'debug 抛错后 running 必须为 false');
}

async function testSynchronousTableUpdateSubscription(mod) {
    let unsubscribeCalls = 0;
    const h = createHarness(mod, {
        subscribeTableUpdate(callback) {
            callback();
            callback();
            return () => { unsubscribeCalls += 1; };
        },
    });
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-sync-subscription');

    assert.deepStrictEqual(h.clock.delays(), [250], '同步收到两次通知后不得再遗留 3.5s timeout');
    assert.strictEqual(unsubscribeCalls, 1, '同步完成订阅注册后必须立刻解除订阅');
    await h.clock.tick(250);
    assert.strictEqual(h.state.chronicleStarts, 2);
    assert.strictEqual(h.state.smallStarts, 2);
}

async function testTimeoutAndSecondSignalRace(mod) {
    const timeoutWins = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-timeout-wins');
    const [lateCallback] = timeoutWins.captureSubscribers();
    lateCallback();
    await timeoutWins.clock.tick(3500);
    assert.strictEqual(timeoutWins.state.chronicleStarts, 2, 'timeout 到点时只能兜底启动一次');
    assert.strictEqual(timeoutWins.state.unsubscriptions, 1, 'timeout 获胜时必须恰好调用一次 disposer');
    assert.strictEqual(timeoutWins.subscriberCount(), 0, 'timeout 获胜后 subscriber Set 必须清空');
    lateCallback();
    await timeoutWins.clock.tick(250);
    assert.strictEqual(timeoutWins.state.chronicleStarts, 2, 'timeout 后晚到的第二次通知不得再次启动');
    assert.strictEqual(timeoutWins.state.unsubscriptions, 1, 'timeout 后晚到信号不得重复调用 disposer');
    assert.strictEqual(timeoutWins.subscriberCount(), 0, 'timeout 后晚到信号不得恢复旧 subscriber');

    const signalWins = createHarness(mod);
    mod.startPhoneBackgroundServices('test-enable');
    mod.handlePhoneBackgroundChatChanged('chat-signal-wins');
    signalWins.notify();
    await signalWins.clock.tick(3499);
    signalWins.notify();
    assert.strictEqual(signalWins.state.unsubscriptions, 1, '第二信号获胜时必须恰好调用一次 disposer');
    assert.strictEqual(signalWins.subscriberCount(), 0, '第二信号获胜后 subscriber Set 必须清空');
    await signalWins.clock.tick(1);
    assert.strictEqual(signalWins.state.chronicleStarts, 1, '第二次通知先到时必须取消 3.5s fallback');
    await signalWins.clock.tick(249);
    assert.strictEqual(signalWins.state.chronicleStarts, 2, '第二次通知先到时仅由 250ms settle 启动一次');
    assert.strictEqual(signalWins.state.unsubscriptions, 1, '已取消 timeout 和 settle 完成都不得重复调用 disposer');
    assert.strictEqual(signalWins.subscriberCount(), 0, 'signal 获胜并 settle 后 subscriber Set 必须保持为空');
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const moduleUrl = `${pathToFileURL(path.join(root, 'modules/phone-core/background-services.js')).href}?behavior=${Date.now()}`;
    const mod = await import(moduleUrl);

    await testSecondSignalAndSettle(mod);
    await testTimeoutFallback(mod);
    await testContinuousChatChangesRejectOldGeneration(mod);
    await testContinuousWaitingChatChangesDisposeOldGeneration(mod);
    await testDisableCancelsEveryBarrierPhase(mod);
    await testDisabledChatAndSubscribeFailure(mod);
    await testPartialStartRollsBack(mod);
    await testGenerationInvalidationRollsBackBothSides(mod);
    await testSmallCalendarGenerationInvalidationRollsBackBothSides(mod);
    await testRollbackSurvivesStopAndLoggerFailures(mod);
    await testDebugLoggerCannotBreakLifecycle(mod);
    await testSynchronousTableUpdateSubscription(mod);
    await testTimeoutAndSecondSignalRace(mod);
    mod.__test__resetPhoneBackgroundServices();

    console.log('[通过] 后台派生服务 fake clock 行为：日志异常隔离、失败两侧无条件回滚、generation 重入清理、enabled 启动、双通知稳定、订阅抛错/null 的 3.5s fallback、连续切换 generation、disable/destroy 清理');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
