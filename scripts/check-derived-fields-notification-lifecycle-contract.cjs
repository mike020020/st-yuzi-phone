const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const files = [
    path.join(ROOT, 'modules/phone-core/derived-fields/small-calendar-derived-fields.js'),
    path.join(ROOT, 'modules/phone-core/derived-fields/chronicle-today-relation.js'),
];
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    ['DEBOUNCE_MS = 600', 'PROBE_RETRY_DELAYS', '1000, 2000, 5000', 'notificationVersion', 'generation', 'probeSqliteCapabilityViaApi', 'rounds < 2', 'scheduleDebounce', 'probeTimer', 'debounceTimer'].forEach((needle) => assert.ok(source.includes(needle), `${path.basename(file)} 缺少调度合同 ${needle}`));
    assert.ok(!source.includes('do {'), `${path.basename(file)} 不得保留无界 do/while pending runner`);
}
const callbacks = fs.readFileSync(path.join(ROOT, 'modules/phone-core/callbacks.js'), 'utf8');
assert.ok(callbacks.includes('.forEach') || callbacks.includes('for (const'), '原始回调必须继续逐订阅者分发');
console.log('[通过] 派生字段通知生命周期合同');
