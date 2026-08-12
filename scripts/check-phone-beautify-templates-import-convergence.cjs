const fs = require('fs');
const assert = require('assert/strict');

const read = file => fs.readFileSync(file, 'utf8');
const page = read('modules/settings-app/pages/beautify.js');
const behavior = read('modules/settings-app/pages/beautify-behavior.js');
const builder = read('modules/settings-app/layout/page-builders/editor-builders.js');
const viewer = read('modules/table-viewer/render.js');
const settingsRender = read('modules/settings-app/render.js');
const contextBuilders = read('modules/settings-app/page-renderers/page-context-builders.js');
const workshop = read('modules/content-presets/workshop-service.js');
const legacyImporter = read('modules/phone-beautify-templates/import-export.js');

assert.ok(viewer.includes("from '../phone-beautify-templates/matcher.js';"));
assert.ok(!page.includes('phone-beautify-templates/'));
assert.ok(!builder.includes('phone-beautify-templates/shared.js'));
assert.ok(settingsRender.includes("from '../content-presets/workshop-service.js';"));
assert.ok(settingsRender.includes('createContentPresetWorkshopService({ getTableData })'));
assert.ok(contextBuilders.includes('contentPresetWorkshopService'));
assert.ok(page.includes('contentPresetWorkshopService.getViewModel()'));
assert.ok(page.includes('contentPresetWorkshopService.subscribe('));
assert.ok(behavior.includes('service.prepareImport(await file.text())'));
assert.ok(behavior.includes('service.importPrepared(prepared, prepared.replacesExisting)'));
assert.ok(workshop.includes('const record = runtimeDeps.importContentPreset(input)'));
assert.ok(workshop.includes('const result = await runtimeDeps.replacePresetRecord(record)'));
assert.ok(legacyImporter.includes('export function importPhoneBeautifyPackFromData(input, options = {})'));
assert.ok(legacyImporter.includes('createBeautifyUserTemplateWriteDisabledResult'));
assert.ok(builder.includes('data-action="import"'));
assert.ok(builder.includes('data-action="clear-all"'));
assert.ok(!builder.includes('phone-beautify-restore-defaults-btn'));

console.log('[phone-beautify-templates-import-convergence-check] 新旧导入边界收敛检查通过');
