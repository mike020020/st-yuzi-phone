const fs = require('fs');
const assert = require('assert/strict');

const page = fs.readFileSync('modules/settings-app/pages/beautify.js', 'utf8');
const builder = fs.readFileSync('modules/settings-app/layout/page-builders/editor-builders.js', 'utf8');
const viewer = fs.readFileSync('modules/table-viewer/render.js', 'utf8');

assert.ok(viewer.includes("from '../phone-beautify-templates/matcher.js';"));
assert.ok(page.includes("from '../../phone-beautify-templates/reset.js';"));
assert.ok(!page.includes('phone-beautify-templates/repository.js'));
assert.ok(!page.includes('phone-beautify-templates/import-export.js'));
assert.ok(!page.includes('phone-beautify-templates/shared.js'));
assert.ok(!builder.includes('phone-beautify-templates/shared.js'));
assert.ok(builder.includes('phone-beautify-restore-defaults-btn'));
console.log('[phone-beautify-templates-import-convergence-check] 检查通过');
