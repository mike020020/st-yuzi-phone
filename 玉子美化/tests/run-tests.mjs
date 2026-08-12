import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBundle, decodeCanonicalBase64, matchesItemToTable, normalizePackagePath,
  normalizeTables, readJson, serializeBundle, validateBundle,
} from '../tools/lib.mjs';

const examples = new URL('../examples/', import.meta.url);
const tables = normalizeTables(await readJson(new URL('tables.json', examples)));
assert.equal(tables.length, 2);
assert.deepEqual(tables[0].headers, ['姓名', '状态']);
assert.equal(tables[1].specialType, 'message');
assert.equal(matchesItemToTable({ target: { tableName: '消息记录表', fields: ['发送者'] } }, tables[1]), true);

const realShape = normalizeTables({
  mate: { type: 'chatSheets', version: 2 },
  diagnostics: { createdAt: 'fixture' },
  sheet_character: { uid: 'sheet_character', name: '角色表', content: [['备注', '状态', '姓名']] },
  sheet_message: { uid: 'sheet_message', name: '消息记录表　', content: [['发送者', '内容']] },
});
assert.deepEqual(realShape.map(table => table.sheetKey), ['sheet_character', 'sheet_message']);
assert.equal(realShape[1].isMessage, true);
assert.equal(matchesItemToTable({ target: { tableName: '角色表', fields: ['姓名', '状态'] } }, realShape[0]), true);
assert.equal(matchesItemToTable({ target: { tableName: '消息记录表', fields: ['发送者', '内容'] } }, realShape[1]), true);

for (const invalidPath of ['../page.js', '/page.js', 'C:/page.js', 'a\\page.js', 'https://x/a.js', 'a//b.js', 'a/./b.js', 'a.js?x']) {
  assert.throws(() => normalizePackagePath(invalidPath), invalidPath);
}
assert.equal(normalizePackagePath('pages/character/page.js'), 'pages/character/page.js');
for (const valid of ['', 'Zg==', 'Zm8=', 'Zm9v']) assert.doesNotThrow(() => decodeCanonicalBase64(valid));
for (const invalid of ['Zg', 'Zg=', 'Zg===', 'Z g==', '!!!!', 'AA=A', 'Zm9v\n', 'Zm9v_']) assert.throws(() => decodeCanonicalBase64(invalid));

const bundle = await readJson(new URL('basic-preset.json', examples));
assert.equal(validateBundle(bundle, { strict: true, tables }).ok, true);
for (const mutate of [
  value => { value.extra = true; },
  value => { value.manifest.extra = true; },
  value => { value.manifest.items[0].extra = true; },
  value => { value.manifest.items[0].target.extra = true; },
  value => { value.manifest.items[0].entry.extra = true; },
  value => { value.files['page.js'].extra = true; },
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
assert.equal(firstBuild.formatVersion, 2);
assert.equal(firstBuild.apiVersion, 1);
assert.equal(firstBuild.manifest.items[0].entry.mount, 'page.js');
assert.match(firstBuild.files['page.js'].content, /export function mount\(context\)/);

const exampleModuleUrl = `data:text/javascript;base64,${Buffer.from(firstBuild.files['page.js'].content).toString('base64')}`;
const exampleModule = await import(exampleModuleUrl);
const actionCalls = [];
const nodes = Object.fromEntries(['title', 'rows', 'status', 'previous', 'next'].map(name => [name, { textContent: '', disabled: false }]));
let clickListener = null;
let subscriber = null;
const root = {
  querySelector(selector) { return nodes[selector.replace('#', '')] || null; },
  addEventListener(type, listener) { assert.equal(type, 'click'); clickListener = listener; },
  removeEventListener(type, listener) { assert.equal(type, 'click'); if (clickListener === listener) clickListener = null; },
};
let currentState = { version: 1, tableName: '角色表', headers: ['姓名', '状态'], rows: [['玉子', '正常']], canPrevious: true, canNext: false };
const publishState = patch => {
  currentState = { ...currentState, ...patch, version: currentState.version + 1 };
  subscriber?.(currentState);
};
const context = {
  root,
  getState: () => currentState,
  subscribe(listener) { subscriber = listener; return () => { if (subscriber === listener) subscriber = null; }; },
  actions: {
    async back() {
      actionCalls.push('back');
      return { ok: true, action: 'back', status: 'navigated', targetRoute: 'settings' };
    },
    async previousTable() {
      actionCalls.push('previousTable');
      publishState({ tableName: '上一张表', rows: [['助手', '上一张']], canPrevious: false, canNext: true });
      return { ok: true, action: 'previousTable', status: 'navigated', targetRoute: 'content-preset:previous' };
    },
    async nextTable() {
      actionCalls.push('nextTable');
      return { ok: false, action: 'nextTable', status: 'unavailable' };
    },
    async editCurrentTable() {
      actionCalls.push('editCurrentTable');
      return { ok: true, action: 'editCurrentTable', status: 'navigated', targetRoute: 'table-generic:sheet-a' };
    },
  },
};
const disposeExample = exampleModule.mount(context);
assert.equal(nodes.title.textContent, '角色表');
assert.match(nodes.rows.textContent, /玉子/);
assert.equal(nodes.previous.disabled, false);
assert.equal(nodes.next.disabled, true);
const expectedActionStatus = {
  back: /返回请求已提交/,
  previousTable: /上一张请求已提交/,
  nextTable: /下一张不可用/,
  editCurrentTable: /编辑请求已提交/,
};
for (const action of Object.keys(expectedActionStatus)) {
  const versionBefore = currentState.version;
  const tableBefore = currentState.tableName;
  await clickListener({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action } } : null } });
  assert.match(nodes.status.textContent, expectedActionStatus[action], `示例必须展示 ${action} 的动作结果`);
  if (action === 'previousTable') {
    assert.equal(currentState.version, versionBefore + 1, '上一张动作必须发布新状态');
    assert.equal(nodes.title.textContent, '上一张表');
    assert.match(nodes.rows.textContent, /上一张/);
    assert.equal(nodes.previous.disabled, true);
    assert.equal(nodes.next.disabled, false);
  } else {
    assert.equal(currentState.version, versionBefore, `${action} 不应伪造表状态更新`);
    assert.equal(currentState.tableName, tableBefore, `${action} 不应意外改变当前表`);
  }
}
assert.deepEqual(actionCalls, ['back', 'previousTable', 'nextTable', 'editCurrentTable']);
const failingButton = { dataset: { action: 'editCurrentTable' }, disabled: false };
context.actions.editCurrentTable = async () => { throw new Error('模拟 action 异常'); };
await clickListener({ target: { closest: selector => selector === '[data-action]' ? failingButton : null } });
assert.equal(failingButton.disabled, false, 'action 异常后按钮必须恢复可用');
assert.match(nodes.status.textContent, /编辑失败：模拟 action 异常/, 'action 异常必须显示可理解的失败信息');
publishState({ tableName: '更新后的角色表', rows: [['助手', '已更新']], canNext: true });
assert.equal(nodes.title.textContent, '更新后的角色表');
assert.match(nodes.rows.textContent, /助手/);
assert.equal(nodes.next.disabled, false);
disposeExample();
disposeExample();
assert.equal(clickListener, null, '示例 disposer 必须幂等移除 DOM listener');
assert.equal(subscriber, null, '示例 disposer 必须退订 context 更新');

const scratchRoot = fileURLToPath(new URL('../.tmp-tests/', import.meta.url));
await fs.mkdir(scratchRoot, { recursive: true });
const tempRoot = await fs.mkdtemp(path.join(scratchRoot, 'bundle-'));
const outsideRoot = await fs.mkdtemp(path.join(scratchRoot, 'bundle-outside-'));
try {
  await fs.mkdir(path.join(tempRoot, 'styles', 'fragments'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'assets'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'tables.json'), JSON.stringify({ chatSheets: { fixture: { name: '角色表', content: [['姓名']] } } }));
  await fs.writeFile(path.join(tempRoot, 'page.js'), 'export function mount(context) { context.container.dataset.fixture = "v2"; }\n');
  const baseProject = {
    tablesFile: 'tables.json',
    manifest: {
      id: 'fixture',
      name: '测试项目',
      version: '1.0.0',
      author: '玉子美化测试',
      items: [{ id: 'item', target: { tableName: '角色表', fields: ['姓名'] }, entry: { mount: 'page.js' }, assets: [] }],
    },
    files: { 'page.js': 'page.js' },
    mimeTypes: { 'page.js': 'text/javascript' },
  };
  const projectFile = path.join(tempRoot, 'project.json');
  await fs.writeFile(projectFile, JSON.stringify(baseProject));
  await assert.rejects(() => buildBundle(path.join(tempRoot, 'missing-project.json')));

  const outsideModule = path.join(outsideRoot, 'outside.js');
  await fs.writeFile(outsideModule, 'export const outside = "OUTSIDE";\n');
  const relativeOutside = path.relative(tempRoot, outsideModule).split(path.sep).join('/');
  for (const source of [
    `import { outside } from ${JSON.stringify(relativeOutside)}; export function mount(context) { context.root.textContent = outside; }\n`,
    `export { outside } from ${JSON.stringify(relativeOutside)}; export function mount() {}\n`,
    `export async function mount(context) { const value = await import(${JSON.stringify(relativeOutside)}); context.root.textContent = value.outside; }\n`,
  ]) {
    await fs.writeFile(path.join(tempRoot, 'page.js'), source);
    await fs.writeFile(projectFile, JSON.stringify(baseProject));
    await assert.rejects(() => buildBundle(projectFile), /module dependency 越出项目目录/);
  }
  await fs.writeFile(path.join(tempRoot, 'indirect.js'), `export { outside } from ${JSON.stringify(relativeOutside)};\n`);
  await fs.writeFile(path.join(tempRoot, 'page.js'), 'import { outside } from "./indirect.js"; export function mount(context) { context.root.textContent = outside; }\n');
  await fs.writeFile(projectFile, JSON.stringify(baseProject));
  await assert.rejects(() => buildBundle(projectFile), /module dependency 越出项目目录/);
  await fs.writeFile(path.join(tempRoot, 'helper.js'), 'export const local = "LOCAL";\n');
  await fs.writeFile(path.join(tempRoot, 'page.js'), 'import { local } from "./helper.js"; export function mount(context) { context.root.textContent = local; }\n');
  await fs.writeFile(projectFile, JSON.stringify(baseProject));
  assert.match((await buildBundle(projectFile)).files['page.js'].content, /LOCAL/, '项目内传递依赖必须继续允许');
  await fs.writeFile(path.join(tempRoot, 'page.js'), 'export function mount(context) { context.container.dataset.fixture = "v2"; }\n');

  const entryCss = [
    '@import "./fragments/card.css" layer(theme) supports(display: grid) screen and (min-width: 1px);',
    '@\\69mport "./fragments/escaped-hex.css";',
    '@\\69 mport "./fragments/escaped-hex-space.css";',
    '@i\\mport "./fragments/escaped-simple.css";',
    '@import"./fragments/no-space-double.css";',
    "@import'./fragments/no-space-single.css';",
    '@\\69mport"./fragments/no-space-escaped-double.css";',
    "@\\69 mport'./fragments/no-space-escaped-single.css';",
    '@imported "./fragments/not-inline.css";',
    '@import-url "./fragments/not-inline.css";',
    '"bad',
    '@import "./fragments/recovered.css";',
    '"kept\\',
    '@import "./fragments/not-inline.css";"',
    '.scope { --fake: "@import \'./fragments/not-inline.css\';"; }',
  ].join('\n');
  const cardCss = [
    '.card { background: url("../../assets/a.svg?q=1#icon"); mask: u\\72l(../../assets/a\\29 b.svg); }',
    '.tokens { a: myurl(../../assets/a.svg); b: curl(../../assets/a.svg); c: url/**/(../../assets/a.svg); d: url(data:image/svg+xml,abc); e: url(blob:test); f: url(#icon); g: url(/absolute.svg); }',
    '.bad-a { x: url(foo(url(../../assets/b.svg)); }',
    '.bad-b { x: url("bad"x url(../../assets/b.svg)); }',
    '.bad-c { x: url(../../assets/b.svg "bad" url(../../assets/b.svg)); }',
    '.bad-string { content: "bad',
    '} .after-bad-string { background: url(../../assets/b.svg); }',
  ].join('\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'entry.css'), entryCss);
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'card.css'), cardCss);
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'escaped-hex.css'), '.escaped-hex { color: red; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'escaped-hex-space.css'), '.escaped-hex-space { color: green; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'escaped-simple.css'), '.escaped-simple { color: blue; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'no-space-double.css'), '.no-space-double { color: red; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'no-space-single.css'), '.no-space-single { color: green; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'no-space-escaped-double.css'), '.no-space-escaped-double { color: blue; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'no-space-escaped-single.css'), '.no-space-escaped-single { color: purple; }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'recovered.css'), '.recovered { background: url(../../assets/b.svg); }\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'not-inline.css'), '.must-not-inline { color: red; }\n');
  await fs.writeFile(path.join(tempRoot, 'assets', 'a.svg'), '<svg id="a"/>');
  await fs.writeFile(path.join(tempRoot, 'assets', 'a)b.svg'), '<svg id="paren"/>');
  await fs.writeFile(path.join(tempRoot, 'assets', 'b.svg'), '<svg id="b"/>');
  const cssProject = structuredClone(baseProject);
  cssProject.manifest.items[0].entry.css = 'styles/entry.css';
  cssProject.manifest.items[0].assets = ['assets/a.svg', 'assets/a)b.svg', 'assets/b.svg'];
  Object.assign(cssProject.files, {
    'styles/entry.css': 'styles/entry.css',
    'styles/fragments/card.css': 'styles/fragments/card.css',
    'styles/fragments/escaped-hex.css': 'styles/fragments/escaped-hex.css',
    'styles/fragments/escaped-hex-space.css': 'styles/fragments/escaped-hex-space.css',
    'styles/fragments/escaped-simple.css': 'styles/fragments/escaped-simple.css',
    'styles/fragments/no-space-double.css': 'styles/fragments/no-space-double.css',
    'styles/fragments/no-space-single.css': 'styles/fragments/no-space-single.css',
    'styles/fragments/no-space-escaped-double.css': 'styles/fragments/no-space-escaped-double.css',
    'styles/fragments/no-space-escaped-single.css': 'styles/fragments/no-space-escaped-single.css',
    'styles/fragments/recovered.css': 'styles/fragments/recovered.css',
    'styles/fragments/not-inline.css': 'styles/fragments/not-inline.css',
    'assets/a.svg': 'assets/a.svg',
    'assets/a)b.svg': 'assets/a)b.svg',
    'assets/b.svg': 'assets/b.svg',
  });
  Object.assign(cssProject.mimeTypes, {
    'styles/entry.css': 'text/css',
    'styles/fragments/card.css': 'text/css',
    'styles/fragments/escaped-hex.css': 'text/css',
    'styles/fragments/escaped-hex-space.css': 'text/css',
    'styles/fragments/escaped-simple.css': 'text/css',
    'styles/fragments/no-space-double.css': 'text/css',
    'styles/fragments/no-space-single.css': 'text/css',
    'styles/fragments/no-space-escaped-double.css': 'text/css',
    'styles/fragments/no-space-escaped-single.css': 'text/css',
    'styles/fragments/recovered.css': 'text/css',
    'styles/fragments/not-inline.css': 'text/css',
    'assets/a.svg': 'image/svg+xml',
    'assets/a)b.svg': 'image/svg+xml',
    'assets/b.svg': 'image/svg+xml',
  });
  await fs.writeFile(projectFile, JSON.stringify(cssProject));
  const cssBundle = await buildBundle(projectFile);
  const css = cssBundle.files['styles/entry.css'].content;
  assert.doesNotMatch(css, /^@import "\.\/fragments\/card\.css"/m, '顶层本地 import 必须内联');
  assert.match(css, /\.escaped-hex \{ color: red; \}/, 'hex escaped @import 必须内联');
  assert.match(css, /\.escaped-hex-space \{ color: green; \}/, '带终止空白的 hex escaped @import 必须内联');
  assert.match(css, /\.escaped-simple \{ color: blue; \}/, 'simple escaped @import 必须内联');
  assert.match(css, /\.no-space-double \{ color: red; \}/, '双引号字符串紧邻 @import 时必须内联');
  assert.match(css, /\.no-space-single \{ color: green; \}/, '单引号字符串紧邻 @import 时必须内联');
  assert.match(css, /\.no-space-escaped-double \{ color: blue; \}/, '双引号字符串紧邻 escaped @import 时必须内联');
  assert.match(css, /\.no-space-escaped-single \{ color: purple; \}/, '单引号字符串紧邻带终止空白的 escaped @import 时必须内联');
  assert.match(css, /@imported "\.\/fragments\/not-inline\.css";/, '非 import at-keyword 不得被误内联');
  assert.match(css, /@import-url "\.\/fragments\/not-inline\.css";/, 'import 前缀名称不得被误内联');
  assert.match(css, /@layer theme \{\n@supports \(display: grid\) \{\n@media screen and \(min-width: 1px\) \{/);
  assert.match(css, /url\("\.\.\/assets\/a\.svg\?q=1#icon"\)/, '导入 CSS 的 query/hash 必须随路径重基准保留');
  assert.match(css, /url\("\.\.\/assets\/a\)b\.svg"\)/, 'CSS escape 解码后的右括号路径必须安全 quoted');
  assert.match(css, /\.recovered \{ background: url\("\.\.\/assets\/b\.svg"\); \}/, 'bad-string 换行后必须恢复顶层 import 扫描');
  assert.match(css, /@import "\.\/fragments\/not-inline\.css";/, 'escaped newline continuation 内的 import 外观文本不得内联');
  assert.doesNotMatch(css, /\.must-not-inline \{/, '字符串和规则块中的伪 import 不得引入文件内容');
  for (const badUrl of [
    'url(foo(url(../../assets/b.svg))',
    'url("bad"x url(../../assets/b.svg))',
    'url(../../assets/b.svg "bad" url(../../assets/b.svg))',
  ]) assert.ok(css.includes(badUrl), `bad-url 必须整体原样保留：${badUrl}`);
  assert.match(css, /\.after-bad-string \{ background: url\("\.\.\/assets\/b\.svg"\); \}/, 'bad-string 后合法 URL 必须继续重基准');
  for (const unchanged of ['myurl(../../assets/a.svg)', 'curl(../../assets/a.svg)', 'url/**/(../../assets/a.svg)', 'url(data:image/svg+xml,abc)', 'url(blob:test)', 'url(#icon)', 'url(/absolute.svg)']) assert.ok(css.includes(unchanged), `外部或非 url token 必须保持：${unchanged}`);

  await fs.writeFile(path.join(tempRoot, 'styles', 'entry.css'), '@import "./fragments/cycle-a.css";\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'cycle-a.css'), '@import "./cycle-b.css";\n');
  await fs.writeFile(path.join(tempRoot, 'styles', 'fragments', 'cycle-b.css'), '@import "./cycle-a.css";\n');
  cssProject.files['styles/fragments/cycle-a.css'] = 'styles/fragments/cycle-a.css';
  cssProject.files['styles/fragments/cycle-b.css'] = 'styles/fragments/cycle-b.css';
  cssProject.mimeTypes['styles/fragments/cycle-a.css'] = 'text/css';
  cssProject.mimeTypes['styles/fragments/cycle-b.css'] = 'text/css';
  await fs.writeFile(projectFile, JSON.stringify(cssProject));
  await assert.rejects(() => buildBundle(projectFile), /CSS @import 循环：styles\/entry\.css -> styles\/fragments\/cycle-a\.css -> styles\/fragments\/cycle-b\.css -> styles\/fragments\/cycle-a\.css/);

  const escapingProject = structuredClone(baseProject);
  escapingProject.files['outside.txt'] = '../outside.txt';
  await fs.writeFile(projectFile, JSON.stringify(escapingProject));
  await assert.rejects(() => buildBundle(projectFile), /结构校验失败|项目内相对路径|越出项目目录/);

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
