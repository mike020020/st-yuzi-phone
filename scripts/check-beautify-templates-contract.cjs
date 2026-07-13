const fs = require('fs');
const assert = require('assert/strict');

const read = file => fs.readFileSync(file, 'utf8');
const files = {
    cache: read('modules/phone-beautify-templates/cache.js'),
    repository: read('modules/phone-beautify-templates/repository.js'),
    matcher: read('modules/phone-beautify-templates/matcher.js'),
    policy: read('modules/phone-beautify-templates/policy.js'),
    reset: read('modules/phone-beautify-templates/reset.js'),
    page: read('modules/settings-app/pages/beautify.js'),
    builder: read('modules/settings-app/layout/page-builders/editor-builders.js'),
    types: read('types.d.ts'),
};

assert.ok(files.cache.includes('invalidatePhoneBeautifyTemplateCache'));
assert.ok(files.repository.includes('getBeautifyTemplateSourceModeRuntime'));
assert.ok(files.matcher.includes("reason: 'manual_binding'"), '历史 binding 读取必须保留');
assert.ok(files.matcher.includes('store.bindings?.[safeSheetKey]'));
assert.ok(files.policy.includes('BEAUTIFY_USER_TEMPLATE_WRITE_DISABLED'));
assert.ok(files.reset.includes('restorePhoneBeautifyTemplatesToBuiltinDefaults'));
assert.ok(files.page.includes('restorePhoneBeautifyTemplatesToBuiltinDefaults'));
assert.ok(!files.page.includes('getPhoneBeautifyTemplatesByType'));
assert.ok(!files.page.includes('FileReader'));
assert.ok(files.builder.includes('phone-beautify-restore-defaults-btn'));
for (const old of ['phone-beautify-import-', 'phone-beautify-export-', 'phone-beautify-list-']) assert.ok(!files.builder.includes(old));
assert.ok(files.types.includes('PhoneBeautifyTemplateResetResult'));
console.log('[beautify-templates-contract-check] 检查通过');
