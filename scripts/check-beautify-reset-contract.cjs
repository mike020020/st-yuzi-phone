const fs = require('fs');
const assert = require('assert/strict');

const read = file => fs.readFileSync(file, 'utf8');
const reset = read('modules/phone-beautify-templates/reset.js');
const builtin = read('modules/phone-beautify-templates/defaults/builtin-templates.js');

assert.equal((reset.match(/savePhoneSettingsPatch\s*\(/g) || []).length, 1, 'reset 必须只调用一次批量 patch');
for (const token of [
    'PHONE_BEAUTIFY_STORE_KEY',
    'BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL',
    'BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC',
    'BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL',
    'BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC',
    'templates: []',
    'bindings: {}',
    'invalidatePhoneBeautifyTemplateCache();',
    'readTemplateStore()',
    'getPhoneSettings()',
    'detectSpecialTemplateForTable',
    'detectGenericTemplateForTable',
]) assert.ok(reset.includes(token), `reset 缺少 ${token}`);
assert.ok(reset.includes("special_message: DEFAULT_SPECIAL_TEMPLATE_ID"));
assert.ok(reset.includes("builtin.special.message.v1"));
assert.ok(reset.includes("builtin.generic.table.v1"));
assert.ok(!reset.includes('setActiveBeautifyTemplateIdByType('));
assert.ok(!reset.includes('saveTemplateStore('));
assert.ok(builtin.includes('fieldBindings: {'), '内置 fieldBindings 必须保留');
console.log('[beautify-reset-contract-check] 检查通过');
