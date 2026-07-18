const fs = require('fs');
const assert = require('assert/strict');

const legacyRepository = fs.readFileSync('modules/phone-beautify-templates/repository.js', 'utf8');
const contentRepository = fs.readFileSync('modules/content-presets/repository.js', 'utf8');
const workshop = fs.readFileSync('modules/content-presets/workshop-service.js', 'utf8');
const behavior = fs.readFileSync('modules/settings-app/pages/beautify-behavior.js', 'utf8');

assert.ok(legacyRepository.includes('export function deletePhoneBeautifyUserTemplate(templateId)'));
assert.ok(legacyRepository.includes('createBeautifyUserTemplateWriteDisabledResult()'));
assert.ok(!legacyRepository.includes('cleanupActiveSettingsForDeletedTemplate'));

for (const operation of ['replacePresetRecord', 'deletePresetRecord']) {
    const start = contentRepository.indexOf(`export async function ${operation}`);
    assert.notEqual(start, -1, `${operation} 必须存在`);
    const body = contentRepository.slice(start, contentRepository.indexOf('\n}', start) + 2);
    assert.ok(body.includes('[CONTENT_PRESET_STORES.presets, CONTENT_PRESET_STORES.activeByTable]'), `${operation} 必须在同一事务覆盖预设与绑定 store`);
    assert.ok(body.includes('removePresetBindings(tx,'), `${operation} 必须在事务内清理引用绑定`);
}
assert.ok(workshop.includes('async deletePreset(presetId)'));
assert.ok(workshop.includes('() => deletePresetRecord(presetId)'));
assert.ok(workshop.includes('metadata.delete(result.presetId)'));
assert.ok(workshop.includes('result.affectedSheetKeys.forEach(key => activeByTable.delete(key))'));
assert.ok(behavior.includes('service.deletePreset(presetId)'));
assert.ok(behavior.includes('并原子清除所有引用它的表绑定'));

console.log('[beautify-template-delete-active-cleanup-check] 新工坊原子删除与旧禁写边界检查通过');
