const fs = require('fs');
const assert = require('assert/strict');

const repository = fs.readFileSync('modules/phone-beautify-templates/repository.js', 'utf8');
const reset = fs.readFileSync('modules/phone-beautify-templates/reset.js', 'utf8');
const behavior = fs.readFileSync('modules/settings-app/pages/beautify-behavior.js', 'utf8');

assert.ok(repository.includes('export function deletePhoneBeautifyUserTemplate(templateId)'));
assert.ok(repository.includes('createBeautifyUserTemplateWriteDisabledResult()'));
assert.ok(!repository.includes('cleanupActiveSettingsForDeletedTemplate'));
assert.ok(reset.includes('templates: []'));
assert.ok(reset.includes('bindings: {}'));
assert.ok(reset.includes('[BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL]: { ...DEFAULT_SPECIAL_ACTIVE_MAP }'));
assert.ok(behavior.includes('永久删除并恢复默认'));
assert.ok(!behavior.includes('phone-beautify-delete-one'));
console.log('[beautify-template-delete-active-cleanup-check] 已替换为统一恢复合同，检查通过');
