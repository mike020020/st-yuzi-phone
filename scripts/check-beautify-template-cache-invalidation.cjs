const fs = require('fs');
const assert = require('assert/strict');

const cache = fs.readFileSync('modules/phone-beautify-templates/cache.js', 'utf8');
const repository = fs.readFileSync('modules/phone-beautify-templates/repository.js', 'utf8');
const reset = fs.readFileSync('modules/phone-beautify-templates/reset.js', 'utf8');

assert.ok(cache.includes('generation: 0,'));
assert.ok(cache.includes('derivedCache.generation += 1;'));
assert.ok(cache.includes('const generationBeforeProducer = derivedCache.generation;'));
assert.ok(cache.includes('if (derivedCache.generation === generationBeforeProducer)'));
assert.ok(repository.includes('function saveBeautifyTemplateSettingAndInvalidate(settingKey, value)'));
assert.ok(repository.includes('export function repairActiveBeautifyTemplateSettings()'));
assert.ok(repository.includes('return createBeautifyUserTemplateWriteDisabledResult();'));
assert.ok(reset.includes('invalidatePhoneBeautifyTemplateCache();'));
assert.ok(reset.includes('const verification = verifyRestoredDefaults();'));
assert.ok(reset.includes('specialRuntimeBuiltin'));
assert.ok(reset.includes('genericRuntimeBuiltin'));
console.log('[beautify-template-cache-invalidation-check] 检查通过');
