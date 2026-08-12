const fs = require('fs');
const assert = require('assert/strict');

const read = file => fs.readFileSync(file, 'utf8');
const reset = read('modules/phone-beautify-templates/reset.js');
const builtin = read('modules/phone-beautify-templates/defaults/builtin-templates.js');

assert.equal((reset.match(/savePhoneSettingsPatch\s*\(/g) || []).length, 1, 'reset 必须只调用一次批量 patch');
for (const token of [
    'PHONE_BEAUTIFY_STORE_KEY',
    'BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC',
    'BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC',
    'templates: []',
    'bindings: {}',
    'invalidatePhoneBeautifyTemplateCache();',
    'readTemplateStore()',
    'getPhoneSettings()',
    'detectGenericTemplateForTable',
    'builtin.generic.table.v1',
]) assert.ok(reset.includes(token), `reset 缺少 ${token}`);

for (const removed of [
    'BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL',
    'BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL',
    'detectSpecialTemplateForTable',
    'special_message',
    'builtin.special.message.v1',
]) assert.equal(reset.includes(removed), false, `reset 不得保留 ${removed}`);

assert.ok(builtin.includes('fieldBindings: {'), '内置 fieldBindings 必须保留');
assert.ok(builtin.includes("templateType: PHONE_TEMPLATE_TYPE_GENERIC"));
assert.equal(builtin.includes('builtin.special.message.v1'), false, '内置模板不得保留消息记录表专属模板');
console.log('[beautify-reset-contract-check] 检查通过');
