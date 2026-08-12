import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tablesRoot = path.join(projectRoot, 'tables');
const sourcesRoot = path.join(tablesRoot, 'sources');
const generatedRoot = path.join(tablesRoot, 'generated');
const tableSource = require('./table-source.cjs');

const formalTables = Object.freeze([
  Object.freeze({ label: '小剧场2.1', expectedSheets: 6 }),
  Object.freeze({ label: '纪要', expectedSheets: 1 }),
]);

function sortedEntryNames(directory, kind) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => (kind === 'directory' ? entry.isDirectory() : entry.isFile()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

assert.deepEqual(
  sortedEntryNames(sourcesRoot, 'directory'),
  formalTables.map(item => item.label).sort((left, right) => left.localeCompare(right, 'zh-CN')),
  'tables/sources 必须且只能包含两套内置 Markdown 事实源',
);
assert.deepEqual(
  sortedEntryNames(generatedRoot, 'file'),
  formalTables.map(item => `${item.label}.json`).sort((left, right) => left.localeCompare(right, 'zh-CN')),
  'tables/generated 必须且只能包含两套 committed generated JSON',
);

for (const definition of formalTables) {
  const sourceDirectory = path.join(sourcesRoot, definition.label);
  const generatedFile = path.join(generatedRoot, `${definition.label}.json`);
  const generatedBytesBefore = fs.readFileSync(generatedFile);
  const committed = JSON.parse(generatedBytesBefore.toString('utf8'));
  const checked = tableSource.checkSourceDirectory(sourceDirectory);
  assert.deepEqual(
    checked,
    { mateCount: 1, sheetCount: definition.expectedSheets },
    `${definition.label} Markdown 事实源计数不符`,
  );
  tableSource.validateChatSheetsTemplate(committed);
  const rebuiltInMemory = tableSource.buildTemplateFromDirectory(sourceDirectory);
  assert.deepStrictEqual(
    rebuiltInMemory,
    committed,
    `${definition.label} Markdown 与 committed generated JSON 不深度等价`,
  );
  assert.equal(tableSource.roundtripTemplate(generatedFile), true, `${definition.label} 无损往返失败`);
  assert.deepEqual(
    fs.readFileSync(generatedFile),
    generatedBytesBefore,
    `${definition.label} freshness 检查不得重写 committed generated JSON`,
  );
  console.log(`[tables:check] OK | ${definition.label} | ${definition.expectedSheets} 张表 | 深度等价且往返无损`);
}

console.log('[tables:check] 通过；正式 generated JSON 未被重写');
