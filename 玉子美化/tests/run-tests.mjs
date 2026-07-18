import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildBundle, decodeCanonicalBase64, matchesItemToTable, normalizePackagePath,
  normalizeTables, readJson, serializeBundle, validateBundle,
} from '../tools/lib.mjs';

const examples = new URL('../examples/', import.meta.url);
const tables = normalizeTables(await readJson(new URL('tables.json', examples)));
assert.equal(tables.length, 2);
assert.deepEqual(tables[0].headers, ['姓名', '状态']);
assert.equal(tables[1].specialType, 'message');
assert.equal(matchesItemToTable({ target: { tableName: '消息记录表', fields: ['发送者'] } }, tables[1]), false);

const realShape = normalizeTables({
  mate: { type: 'chatSheets', version: 2 },
  diagnostics: { createdAt: 'fixture' },
  sheet_character: { uid: 'sheet_character', name: '角色表', content: [['备注', '状态', '姓名']] },
  sheet_message: { uid: 'sheet_message', name: '消息记录表　', content: [['发送者', '内容']] },
});
assert.deepEqual(realShape.map(table => table.sheetKey), ['sheet_character', 'sheet_message']);
assert.equal(realShape[1].isMessage, true);
assert.equal(matchesItemToTable({ target: { tableName: '角色表', fields: ['姓名', '状态'] } }, realShape[0]), true);

for (const invalidPath of ['../page.js', '/page.js', 'C:/page.js', 'a\\page.js', 'https://x/a.js', 'a//b.js', 'a/./b.js', 'a.js?x']) {
  assert.throws(() => normalizePackagePath(invalidPath), invalidPath);
}
assert.equal(normalizePackagePath('pages/character/page.js'), 'pages/character/page.js');
for (const valid of ['', 'Zg==', 'Zm8=', 'Zm9v']) assert.doesNotThrow(() => decodeCanonicalBase64(valid));
for (const invalid of ['Zg', 'Zg=', 'Zg===', 'Z g==', '!!!!', 'AA=A', 'Zm9v\n', 'Zm9v_']) assert.throws(() => decodeCanonicalBase64(invalid));

const bundle = await readJson(new URL('basic-preset.json', examples));
assert.equal(validateBundle(bundle, { strict: true, tables }).ok, true);
for (const mutate of [
  value => { value.manifest.items[0].entry.html = '../page.html'; value.files['../page.html'] = value.files['page.html']; },
  value => { value.manifest.items[0].target.fields = []; },
  value => { value.manifest.items[0].target.fields = ['Ａ', 'A']; },
  value => { value.files['page.js'] = { ...value.files['page.js'], encoding: 'base64', content: '***not-base64***' }; },
  value => { value.manifest.items[0].target.tableName = '不存在的表'; },
]) {
  const invalid = structuredClone(bundle);
  mutate(invalid);
  assert.equal(validateBundle(invalid, { strict: true, tables }).ok, false);
}


const projectUrl = new URL('project.json', examples);
const firstBuild = await buildBundle(projectUrl);
const secondBuild = await buildBundle(projectUrl);
assert.equal(serializeBundle(firstBuild), serializeBundle(secondBuild), '重复构建必须字节确定');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yuzi-beautify-'));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yuzi-beautify-outside-'));
try {
  await fs.writeFile(path.join(tempRoot, 'tables.json'), JSON.stringify({ chatSheets: { fixture: { name: '角色表', content: [['姓名']] } } }));
  await fs.writeFile(path.join(tempRoot, 'page.js'), 'console.log(1);\n');
  const baseProject = {
    tablesFile: 'tables.json',
    manifest: { id: 'fixture', items: [{ id: 'item', target: { tableName: '角色表', fields: ['姓名'] }, entry: { js: 'page.js' }, assets: [] }] },
    files: { 'page.js': 'page.js' },
    mimeTypes: { 'page.js': 'text/javascript' },
  };
  const projectFile = path.join(tempRoot, 'project.json');
  await fs.writeFile(projectFile, JSON.stringify(baseProject));
  await assert.rejects(() => buildBundle(path.join(tempRoot, 'missing-project.json')));
  const escapingProject = structuredClone(baseProject);
  escapingProject.files['outside.txt'] = '../outside.txt';
  await fs.writeFile(projectFile, JSON.stringify(escapingProject));
  await assert.rejects(() => buildBundle(projectFile), /项目内相对路径|越出项目目录/);

  await fs.writeFile(path.join(outsideRoot, 'outside.js'), 'console.log("outside");\n');
  await fs.writeFile(path.join(outsideRoot, 'outside-tables.json'), JSON.stringify({ chatSheets: { outside: { name: '角色表', content: [['姓名']] } } }));
  let symlinkSupported = true;
  try {
    await fs.symlink(path.join(outsideRoot, 'outside.js'), path.join(tempRoot, 'linked-page.js'), 'file');
    await fs.symlink(path.join(outsideRoot, 'outside-tables.json'), path.join(tempRoot, 'linked-tables.json'), 'file');
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error;
    symlinkSupported = false;
    console.warn(`[yuzi-beautify-tests] 跳过 symlink containment：${error.code}`);
  }
  if (symlinkSupported) {
    const linkedSourceProject = structuredClone(baseProject);
    linkedSourceProject.files['page.js'] = 'linked-page.js';
    await fs.writeFile(projectFile, JSON.stringify(linkedSourceProject));
    await assert.rejects(() => buildBundle(projectFile), /越出项目目录/);

    const linkedTablesProject = structuredClone(baseProject);
    linkedTablesProject.tablesFile = 'linked-tables.json';
    await fs.writeFile(projectFile, JSON.stringify(linkedTablesProject));
    await assert.rejects(() => buildBundle(projectFile), /越出项目目录/);

    await fs.symlink(path.join(tempRoot, 'page.js'), path.join(tempRoot, 'linked-inside.js'), 'file');
    const insideLinkProject = structuredClone(baseProject);
    insideLinkProject.files['page.js'] = 'linked-inside.js';
    await fs.writeFile(projectFile, JSON.stringify(insideLinkProject));
    await assert.doesNotReject(() => buildBundle(projectFile));
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
}

console.log('[yuzi-beautify-tests] 通过');
