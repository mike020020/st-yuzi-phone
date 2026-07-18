const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'modules/phone-core/derived-fields/derived-field-service.js');
const DERIVED_FIELD_ADAPTERS = [
    {
        path: path.join(ROOT, 'modules/phone-core/derived-fields/small-calendar-derived-fields.js'),
        start: 'startSmallCalendarDerivedFieldsInjection',
        stop: 'stopSmallCalendarDerivedFieldsInjection',
    },
    {
        path: path.join(ROOT, 'modules/phone-core/derived-fields/chronicle-today-relation.js'),
        start: 'startChronicleTodayRelationInjection',
        stop: 'stopChronicleTodayRelationInjection',
    },
];

function assertIncludes(source, needle, message) {
    assert.ok(source.includes(needle), message);
}

function assertNotIncludes(source, needle, message) {
    assert.ok(!source.includes(needle), message);
}

function readSection(source, startNeedle, endNeedle, label) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `${label} 缺少起点 ${startNeedle}`);
    assert.ok(end > start, `${label} 缺少终点 ${endNeedle}`);
    return source.slice(start, end);
}

const serviceSource = fs.readFileSync(SERVICE_PATH, 'utf8');

[
    'const DEFAULT_DEBOUNCE_MS = 600;',
    'const DEFAULT_PROBE_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);',
    'const DEFAULT_QUERY_RETRY_DELAYS = Object.freeze([1000, 2000, 5000]);',
    'const DEFAULT_MUTATION_RETRY_DELAY_MS = 2000;',
    'const DEFAULT_MAX_MUTATION_ATTEMPTS = 2;',
    'notificationVersion',
    'consumedVersion',
    'generation',
    'runtime.running',
    'while (rounds < 2 && isCurrent(generation))',
    'probeTimer',
    'debounceTimer',
    'queryRetryTimer',
    'mutationRetryTimer',
].forEach((needle) => {
    assertIncludes(serviceSource, needle, `共享派生服务缺少调度合同 ${needle}`);
});
assertNotIncludes(serviceSource, 'do {', '共享派生服务不得保留无界 do/while pending runner');
assertNotIncludes(serviceSource, 'MUTATION_RETRY_DELAYS', 'mutation 只能有一次补试延迟，不得复用三段读侧退避数组');

const requestRunSource = readSection(serviceSource, 'function requestRun()', 'function clearRuntimeState()', 'requestRun');
assertIncludes(requestRunSource, 'runtime.notificationVersion += 1;', '普通通知必须只增加脏版本');
assertIncludes(requestRunSource, 'scheduleDebounce(runtime.generation);', '空闲时的普通通知必须安排合并调度');
[
    'runtime.mutationAttempts = 0',
    'runtime.mutationCircuitOpen = false',
    'runtime.mutationSourceSignature = null',
    'alignMutationBudget(',
].forEach((needle) => {
    assertNotIncludes(requestRunSource, needle, `普通通知不得重新武装同源 mutation 预算：${needle}`);
});

const alignBudgetSource = readSection(serviceSource, 'function alignMutationBudget(', 'function markMutationConfirmed(', 'alignMutationBudget');
assertIncludes(alignBudgetSource, 'if (runtime.mutationSourceSignature === source) return;', '同一 source signature 必须保留现有 mutation 预算');
assertIncludes(alignBudgetSource, 'runtime.mutationSourceSignature = source;', 'source signature 变化时必须记录新业务源');
assertIncludes(alignBudgetSource, 'runtime.mutationAttempts = 0;', 'source signature 变化时必须重新武装 mutation 次数');
assertIncludes(alignBudgetSource, 'runtime.mutationCircuitOpen = false;', 'source signature 变化时必须关闭旧源熔断');

const markConfirmedSource = readSection(serviceSource, 'function markMutationConfirmed(', 'function beginMutationAttempt(', 'markMutationConfirmed');
assertIncludes(markConfirmedSource, 'runtime.pendingConfirmationSourceSignature = null;', '成功确认必须清理 confirmation-only 状态');
assertIncludes(markConfirmedSource, "clearTimer('mutationRetryTimer');", '成功确认必须清理 mutation retry timer');
assertNotIncludes(markConfirmedSource, 'runtime.mutationAttempts = 0;', '成功确认不得重新武装同源 mutation 次数');
assertNotIncludes(markConfirmedSource, 'runtime.mutationCircuitOpen = false;', '成功确认不得关闭同源熔断');

const runPassSource = readSection(serviceSource, 'async function runPass(', 'async function runRound(', 'runPass');
assertIncludes(runPassSource, 'if (pre.pendingUpdateCount === 0)', 'pending_update_count=0 时必须在 mutation 前完成本轮');
assert.ok(
    runPassSource.indexOf('if (pre.pendingUpdateCount === 0)') < runPassSource.indexOf('await deps.mutation('),
    'pending_update_count 零写入门必须位于 mutation 调用之前',
);

const markFailedSource = readSection(serviceSource, 'function markMutationFailed(', 'function warnMutationCircuit(', 'markMutationFailed');
assertIncludes(markFailedSource, 'runtime.mutationAttempts >= maxMutationAttempts', '同源 mutation 必须按 maxMutationAttempts 判断预算耗尽');
assertIncludes(markFailedSource, 'runtime.mutationCircuitOpen = true;', '第二次明确失败后必须打开同源熔断');

const scheduleMutationRetrySource = readSection(serviceSource, 'function scheduleMutationRetry(', 'function clearReadFailureState(', 'scheduleMutationRetry');
assertIncludes(scheduleMutationRetrySource, 'markMutationFailed(sourceSignature)', 'mutation 补试前必须消费同源失败预算');
assertIncludes(scheduleMutationRetrySource, 'mutationRetryDelayMs', 'mutation 必须使用单个有限补试延迟');

const clearRuntimeSource = readSection(serviceSource, 'function clearRuntimeState()', 'function rollbackFailedStart(', 'clearRuntimeState');
['debounceTimer', 'probeTimer', 'queryRetryTimer', 'mutationRetryTimer'].forEach((timerName) => {
    assertIncludes(clearRuntimeSource, `clearTimer('${timerName}');`, `完整清理必须覆盖 ${timerName}`);
});
['runtime.notificationVersion = 0;', 'runtime.running = false;', 'runtime.mutationSourceSignature = null;', 'runtime.mutationAttempts = 0;'].forEach((needle) => {
    assertIncludes(clearRuntimeSource, needle, `完整清理缺少 ${needle}`);
});

const rollbackStartSource = readSection(serviceSource, 'function rollbackFailedStart(', 'function start()', 'rollbackFailedStart');
assertIncludes(rollbackStartSource, 'clearRuntimeState();', '启动失败必须回滚全部运行状态');
assertIncludes(rollbackStartSource, '.start-failed', '启动失败必须记录结构化警告');

const startSource = readSection(serviceSource, 'function start()', 'function stop()', 'start');
assertIncludes(startSource, 'try {', '启动订阅必须捕获异常');
assertIncludes(startSource, "'invalid-disposer'", '启动必须拒绝无效 disposer');
assertIncludes(startSource, 'rollbackFailedStart(', '任一启动失败必须统一回滚');

const stopSource = readSection(serviceSource, 'function stop()', 'function setDeps(', 'stop');
assertIncludes(stopSource, 'finally {', 'stop 必须使用 finally 保证剩余清理');
assertIncludes(stopSource, 'clearRuntimeState();', 'disposer 抛错后仍必须清理全部运行状态');
assertIncludes(stopSource, '.stop-unsubscribe-failed', 'disposer 抛错必须记录结构化警告');

for (const adapter of DERIVED_FIELD_ADAPTERS) {
    const source = fs.readFileSync(adapter.path, 'utf8');
    const basename = path.basename(adapter.path);
    [
        'createDerivedFieldService',
        'readDerivedField',
        'querySqlViaApi',
        'probeSqliteCapabilityViaApi',
        'executeSqlMutationViaApi',
        'subscribeTableUpdate',
        'source_signature',
        'input_signature',
        'pending_update_count',
        'maxMutationAttempts: 2',
        adapter.start,
        adapter.stop,
    ].forEach((needle) => assertIncludes(source, needle, `${basename} 缺少共享调度适配合同 ${needle}`));
    ['notificationVersion', 'runtime.running', 'scheduleDebounce', 'probeTimer', 'debounceTimer'].forEach((needle) => {
        assertNotIncludes(source, needle, `${basename} 不得重新复制共享调度实现 ${needle}`);
    });
}

const callbacks = fs.readFileSync(path.join(ROOT, 'modules/phone-core/callbacks.js'), 'utf8');
assert.ok(callbacks.includes('.forEach') || callbacks.includes('for (const'), '原始回调必须继续逐订阅者分发');
console.log('[通过] 派生字段通知生命周期合同：共享调度、通知只标脏、成功确认不重置预算、启动失败完整回滚与适配器隔离');
