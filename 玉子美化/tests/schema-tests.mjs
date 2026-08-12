import assert from 'node:assert/strict';
import { readJson, validateBundle } from '../tools/lib.mjs';
import { validateSchema } from '../tools/schema-validator.mjs';

const bundle = await readJson(new URL('../examples/basic-preset.json', import.meta.url));
const project = await readJson(new URL('../examples/project.json', import.meta.url));
const workflow = await readJson(new URL('../templates/workflow-state.json', import.meta.url));

assert.equal(validateSchema('bundle', bundle).ok, true);
assert.equal(validateSchema('project', project).ok, true);
assert.equal(validateSchema('workflow', workflow).ok, true);

const missingBundleField = structuredClone(bundle);
delete missingBundleField.apiVersion;
assert.equal(validateSchema('bundle', missingBundleField).ok, false);
assert.equal(validateBundle(missingBundleField, { strict: true }).ok, false, 'Bundle Schema 必须真实进入运行门禁');

const extraProjectField = structuredClone(project);
extraProjectField.runtime = 'phone';
assert.equal(validateSchema('project', extraProjectField).ok, false);
const traversalProject = structuredClone(project);
traversalProject.tablesFile = '../tables.json';
assert.equal(validateSchema('project', traversalProject).ok, false);
const incompleteItem = structuredClone(project);
delete incompleteItem.manifest.items[0].entry.mount;
assert.equal(validateSchema('project', incompleteItem).ok, false);

const invalidWorkflowStatus = structuredClone(workflow);
invalidWorkflowStatus.queue = [{
  sheetKey: 'sheet_a',
  tableName: 'A',
  headers: ['字段'],
  schemaHash: 'a'.repeat(64),
  status: 'done',
  itemId: null,
  fields: [],
  skipReason: null,
  completedAt: null,
  preview: { status: 'not-run', recordedAt: null, notes: '' },
}];
assert.equal(validateSchema('workflow', invalidWorkflowStatus).ok, false);
const extraWorkflowField = structuredClone(workflow);
extraWorkflowField.phone = {};
assert.equal(validateSchema('workflow', extraWorkflowField).ok, false);
assert.throws(() => validateSchema('unknown', {}), /未知 Schema 类型/);

console.log('[schema-tests] 通过');
