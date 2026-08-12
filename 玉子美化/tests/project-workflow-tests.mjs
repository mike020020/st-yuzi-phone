import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addProjectItem,
  checkWorkflowProject,
  createProject,
  getProjectStatus,
  importProjectTables,
  skipProjectTable,
  validateChatSheetsDocument,
} from '../tools/project-lib.mjs';
import { readJson } from '../tools/lib.mjs';

const scratchRoot = fileURLToPath(new URL('../.tmp-tests/', import.meta.url));
await fs.mkdir(scratchRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(scratchRoot, 'project-workflow-'));
const projectsDir = path.join(runRoot, 'projects');

try {
  const dry = await createProject({ projectsDir, id: 'dry-project', name: '中文空白草稿', dryRun: true });
  await assert.rejects(() => fs.access(dry.projectDir));
  for (const id of ['../escape', 'CON', '.hidden', 'bad/name', 'bad ', 'A-UPPER']) {
    await assert.rejects(() => createProject({ projectsDir, id, name: '非法项目' }), /项目 id/);
  }

  const created = await createProject({ projectsDir, id: 'yuzi-workflow', name: '玉子中文项目', author: '作者' });
  const blankProject = await readJson(created.projectFile);
  assert.equal(blankProject.manifest.name, '玉子中文项目');
  assert.deepEqual(blankProject.manifest.items, []);
  assert.equal(blankProject.tablesFile, 'tables/generated/tables.json');
  assert.equal((await checkWorkflowProject(created.projectFile, { mode: 'draft' })).ok, true);
  assert.equal((await checkWorkflowProject(created.projectFile, { mode: 'release' })).ok, false);
  await assert.rejects(() => createProject({ projectsDir, id: 'yuzi-workflow', name: '重复项目' }), /拒绝覆盖/);
  delete blankProject.mimeTypes;
  delete blankProject.encodings;
  await fs.writeFile(created.projectFile, `${JSON.stringify(blankProject, null, 2)}\n`, 'utf8');

  const inputFile = fileURLToPath(new URL('../tables/generated/纪要.json', import.meta.url));
  const inputBytes = await fs.readFile(inputFile);
  const importDry = await importProjectTables({ projectFile: created.projectFile, inputFile, dryRun: true });
  assert.equal(importDry.tableCount, 1);
  await assert.rejects(() => fs.access(path.join(created.projectDir, 'tables', 'original', 'imported.json')));
  const imported = await importProjectTables({ projectFile: created.projectFile, inputFile });
  assert.equal(imported.tableCount, 1);
  assert.deepEqual(await fs.readFile(path.join(created.projectDir, 'tables', 'original', 'imported.json')), inputBytes, '原始导入必须字节不变');
  assert.deepEqual(await fs.readFile(inputFile), inputBytes, '导入不能修改来源文件');
  const importedStatus = await getProjectStatus({ projectFile: created.projectFile });
  assert.equal(importedStatus.queue.length, 1);
  assert.equal(importedStatus.queue[0].status, 'pending');
  await assert.rejects(() => importProjectTables({ projectFile: created.projectFile, inputFile }), /拒绝覆盖/);

  const skipDryBefore = await fs.readFile(path.join(created.projectDir, 'workflow-state.json'));
  await skipProjectTable({ projectFile: created.projectFile, table: '纪要表', reason: '本轮明确不制作', dryRun: true });
  assert.deepEqual(await fs.readFile(path.join(created.projectDir, 'workflow-state.json')), skipDryBefore, 'skip --dry-run 必须零写入');
  const skipped = await skipProjectTable({ projectFile: created.projectFile, table: '纪要表', reason: '本轮明确不制作' });
  assert.equal(skipped.table.status, 'skipped');
  const resumed = await skipProjectTable({ projectFile: created.projectFile, table: 'sheet_summary', resume: true });
  assert.equal(resumed.table.status, 'pending');

  const pageDir = path.join(created.projectDir, 'pages', 'summary');
  await fs.mkdir(pageDir, { recursive: true });
  await fs.writeFile(path.join(pageDir, 'index.html'), '<section id="summary"></section>\n');
  await fs.writeFile(path.join(pageDir, 'style.css'), '#summary{display:block}\n');
  await fs.writeFile(path.join(pageDir, 'mount.js'), 'export function mount(context){context.root.textContent=context.getState().tableName;return()=>{};}\n');
  await assert.rejects(() => addProjectItem({
    projectFile: created.projectFile,
    table: '纪要表',
    id: 'summary-item',
    fields: ['不存在字段'],
    mount: 'pages/summary/mount.js',
  }), /不存在字段/);
  const beforeAddDry = await fs.readFile(created.projectFile);
  await addProjectItem({
    projectFile: created.projectFile,
    table: '纪要表',
    id: 'summary-item',
    name: '纪要页',
    fields: ['编码索引', '概览'],
    html: 'pages/summary/index.html',
    css: 'pages/summary/style.css',
    mount: 'pages/summary/mount.js',
    previewStatus: 'skipped',
    previewNotes: '用户选择跳过制作期模拟',
    dryRun: true,
  });
  assert.deepEqual(await fs.readFile(created.projectFile), beforeAddDry, 'add-item --dry-run 必须零写入');
  const added = await addProjectItem({
    projectFile: created.projectFile,
    table: '纪要表',
    id: 'summary-item',
    name: '纪要页',
    fields: ['编码索引', '概览'],
    html: 'pages/summary/index.html',
    css: 'pages/summary/style.css',
    mount: 'pages/summary/mount.js',
    previewStatus: 'skipped',
    previewNotes: '用户选择跳过制作期模拟',
  });
  assert.equal(added.state.status, 'completed');
  assert.equal(added.state.preview.status, 'skipped');
  const projectWithInferredMetadata = await readJson(created.projectFile);
  assert.equal(projectWithInferredMetadata.mimeTypes['pages/summary/mount.js'], 'text/javascript');
  assert.equal(projectWithInferredMetadata.encodings['pages/summary/mount.js'], 'text');
  const releaseBeforeConfirmation = await checkWorkflowProject(created.projectFile, { mode: 'release' });
  assert.equal(releaseBeforeConfirmation.ok, false);
  assert.equal(releaseBeforeConfirmation.errors.some(error => /用户确认/.test(error)), true);
  const confirmed = await getProjectStatus({ projectFile: created.projectFile, confirm: true });
  assert.equal(confirmed.confirmation.confirmed, true);
  assert.equal((await checkWorkflowProject(created.projectFile, { mode: 'release' })).ok, true);

  const stateFile = path.join(created.projectDir, 'workflow-state.json');
  const confirmedStateBytes = await fs.readFile(stateFile);
  const stateWithoutSource = JSON.parse(confirmedStateBytes.toString('utf8'));
  stateWithoutSource.tables.sourceDir = null;
  await fs.writeFile(stateFile, `${JSON.stringify(stateWithoutSource, null, 2)}\n`, 'utf8');
  const missingSource = await checkWorkflowProject(created.projectFile, { mode: 'release' });
  assert.equal(missingSource.ok, false);
  assert.equal(missingSource.errors.some(error => /Markdown 事实源目录/.test(error)), true);
  await fs.writeFile(stateFile, confirmedStateBytes);

  const sourceDir = path.join(created.projectDir, 'tables', 'source');
  const sourceSheetName = (await fs.readdir(sourceDir)).find(name => name !== '00-mate.md' && name.endsWith('.md'));
  assert.ok(sourceSheetName, '导入后必须生成逐表 Markdown');
  const sourceSheetFile = path.join(sourceDir, sourceSheetName);
  const sourceSheetBytes = await fs.readFile(sourceSheetFile);
  await fs.writeFile(sourceSheetFile, sourceSheetBytes.toString('utf8').replace('轮次日志。', '轮次日志（测试修改）。'), 'utf8');
  const staleMarkdown = await checkWorkflowProject(created.projectFile, { mode: 'release' });
  assert.equal(staleMarkdown.ok, false);
  assert.equal(staleMarkdown.errors.some(error => /Markdown 事实源与 generated chatSheets/.test(error)), true);
  await fs.writeFile(sourceSheetFile, sourceSheetBytes);
  assert.equal((await checkWorkflowProject(created.projectFile, { mode: 'release' })).ok, true);

  const generatedFile = path.join(created.projectDir, 'tables', 'generated', 'tables.json');
  const changed = await readJson(generatedFile);
  changed.sheet_summary.content[0].push('新增字段');
  await fs.writeFile(generatedFile, `${JSON.stringify(changed, null, 2)}\n`);
  const invalidated = await checkWorkflowProject(created.projectFile, { mode: 'release' });
  assert.equal(invalidated.ok, false);
  assert.equal(invalidated.errors.some(error => /表结构|哈希|重新确认/.test(error)), true);
  const refreshed = await getProjectStatus({ projectFile: created.projectFile, refresh: true });
  assert.equal(refreshed.queue[0].status, 'invalidated');
  assert.equal(refreshed.confirmation.confirmed, false);

  const removalProject = await createProject({ projectsDir, id: 'table-removal', name: '删表状态测试' });
  const removalInput = path.join(runRoot, 'table-removal.json');
  const removalDocument = await readJson(inputFile);
  removalDocument.sheet_summary_copy = {
    ...structuredClone(removalDocument.sheet_summary),
    uid: 'sheet_summary_copy',
    name: '纪要副本',
    orderNo: 1,
  };
  await fs.writeFile(removalInput, `${JSON.stringify(removalDocument, null, 2)}\n`, 'utf8');
  await importProjectTables({ projectFile: removalProject.projectFile, inputFile: removalInput });
  const removalSourceDir = path.join(removalProject.projectDir, 'tables', 'source');
  const removedSource = (await fs.readdir(removalSourceDir)).find(name => name.startsWith('02-') && name.endsWith('.md'));
  assert.ok(removedSource, '双表导入后必须存在第二张表的 Markdown');
  await fs.rm(path.join(removalSourceDir, removedSource));
  const removalGeneratedFile = path.join(removalProject.projectDir, 'tables', 'generated', 'tables.json');
  const removalGenerated = await readJson(removalGeneratedFile);
  delete removalGenerated.sheet_summary_copy;
  await fs.writeFile(removalGeneratedFile, `${JSON.stringify(removalGenerated, null, 2)}\n`, 'utf8');
  const removalStateFile = path.join(removalProject.projectDir, 'workflow-state.json');
  const removalStateBeforeDryRun = await fs.readFile(removalStateFile);
  const removalDryRun = await getProjectStatus({ projectFile: removalProject.projectFile, refresh: true, dryRun: true });
  assert.equal(removalDryRun.ok, true, 'refresh dry-run 应检查刷新后的计划状态');
  assert.deepEqual(removalDryRun.draftErrors, []);
  assert.equal(removalDryRun.queue.some(entry => entry.sheetKey === 'sheet_summary_copy'), false);
  assert.deepEqual(await fs.readFile(removalStateFile), removalStateBeforeDryRun, 'refresh dry-run 必须零写入');
  const removalRefreshed = await getProjectStatus({ projectFile: removalProject.projectFile, refresh: true });
  assert.equal(removalRefreshed.queue.some(entry => entry.sheetKey === 'sheet_summary_copy'), false, '已从 generated 删除的表应退出制作队列');
  assert.equal((await checkWorkflowProject(removalProject.projectFile, { mode: 'draft' })).ok, true, '删表并刷新后草稿检查应通过');
  const stableRemoval = await getProjectStatus({ projectFile: removalProject.projectFile });
  assert.equal(stableRemoval.queue.length, 1);

  const invalidProject = await createProject({ projectsDir, id: 'invalid-import', name: '非法导入测试' });
  const invalidInput = path.join(runRoot, 'invalid.json');
  await fs.writeFile(invalidInput, JSON.stringify({ mate: { type: 'other' }, sheet_a: { content: [['字段']] } }));
  await assert.rejects(() => importProjectTables({ projectFile: invalidProject.projectFile, inputFile: invalidInput }), /chatSheets/);
  await assert.rejects(() => fs.access(path.join(invalidProject.projectDir, 'tables', 'original', 'imported.json')));
  assert.throws(() => validateChatSheetsDocument({
    mate: { type: 'chatSheets' },
    sheet_a: { name: 'A', content: [['Ａ', 'A']] },
  }), /NFKC/);
} finally {
  await fs.rm(runRoot, { recursive: true, force: true });
}

console.log('[project-workflow-tests] 通过');
