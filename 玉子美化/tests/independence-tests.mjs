import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.join(projectRoot, 'references', 'pages');
const pageContracts = Object.freeze({
  calendar: '.yb-calendar-page',
  diary: '.yb-diary-page',
  forum: '.yb-forum-page',
  live: '.yb-live-page',
  square: '.yb-square-page',
});
const expectedPageFiles = Object.freeze(['README.md', 'index.html', 'mount.js', 'style.css']);
const excludedDirectoryNames = new Set(['.analysis-archive', '.git', '.tmp-tests', 'node_modules']);
const productTextExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.yaml', '.yml']);

function ordinarySelectors(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  let buffer = '';
  let quote = '';
  let escaped = false;
  for (const character of source) {
    if (quote) {
      buffer += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === '{') {
      const prelude = buffer.trim();
      if (prelude && !prelude.startsWith('@')) {
        selectors.push(...prelude.split(',').map(value => value.trim()).filter(Boolean));
      }
      buffer = '';
      continue;
    }
    if (character === '}') {
      buffer = '';
      continue;
    }
    buffer += character;
  }
  return selectors;
}

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.analysis-cache.md') continue;
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, output);
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const actualPageDirectories = fs.readdirSync(pagesRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
assert.deepEqual(actualPageDirectories, Object.keys(pageContracts).sort(), '五页参考目录必须精确匹配公开清单');

const forbiddenMountNeedles = Object.freeze([
  [['Auto', 'Card', 'Updater', 'API'].join(''), '数据库全局对象'],
  [['Silly', 'Tavern'].join(''), '宿主全局对象'],
  [['Tavern', 'Helper'].join(''), '助手全局对象'],
  [['global', 'This'].join(''), '外部全局对象'],
  [['win', 'dow'].join(''), '浏览器全局对象'],
  [['local', 'Storage'].join(''), '外部持久化'],
  [['session', 'Storage'].join(''), '外部持久化'],
  [['XMLHttp', 'Request'].join(''), '外部联网'],
  [['fet', 'ch'].join(''), '外部联网'],
  [['insert', 'Row'].join(''), '数据库写入'],
  [['delete', 'Row'].join(''), '数据库删除'],
  [['update', 'Table'].join(''), '数据库写入'],
  [['replace', 'Table'].join(''), '数据库写入'],
  [['generate', 'Text'].join(''), 'AI 生成'],
  [['world', 'book'].join(''), '世界书能力'],
  [['世', '界', '书'].join(''), '世界书能力'],
  [['ph', 'one'].join(''), '手机私有标识'],
]);

for (const [pageName, rootSelector] of Object.entries(pageContracts)) {
  const pageDirectory = path.join(pagesRoot, pageName);
  const files = fs.readdirSync(pageDirectory).sort();
  assert.deepEqual(files, [...expectedPageFiles].sort(), `${pageName} 必须且只能包含四个源码参考文件`);
  assert.equal(fs.existsSync(path.join(pageDirectory, 'project.json')), false, `${pageName} 不得冒充正式预设项目`);

  const css = fs.readFileSync(path.join(pageDirectory, 'style.css'), 'utf8');
  const selectors = ordinarySelectors(css);
  assert.ok(selectors.length > 0, `${pageName} CSS 必须包含普通选择器`);
  for (const selector of selectors) {
    assert.ok(selector.startsWith(rootSelector), `${pageName} CSS 选择器越出独立根作用域：${selector}`);
  }

  const mountSource = fs.readFileSync(path.join(pageDirectory, 'mount.js'), 'utf8');
  assert.doesNotMatch(mountSource, /(?:from\s*|import\s*\(|require\s*\()\s*['"]\.\.[/\\]/, `${pageName} 不得引用父目录模块`);
  for (const [needle, label] of forbiddenMountNeedles) {
    assert.equal(mountSource.toLowerCase().includes(needle.toLowerCase()), false, `${pageName} mount.js 含${label}：${needle}`);
  }
}

const forbiddenMaterialName = ['恋', '爱', '特', '化', '参', '考'].join('');
for (const file of walkFiles(projectRoot)) {
  const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
  if (relative === 'tests/independence-tests.mjs') continue;
  assert.equal(relative.includes(forbiddenMaterialName), false, `项目中出现禁用材料文件名：${relative}`);
  if (!productTextExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content.includes(forbiddenMaterialName), false, `项目中出现禁用材料引用：${relative}`);
}

const implementationRoots = ['examples', 'preview', 'references', 'tools'].map(name => path.join(projectRoot, name));
const moduleSpecifierPattern = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
for (const implementationRoot of implementationRoots) {
  for (const file of walkFiles(implementationRoot)) {
    if (!['.cjs', '.js', '.mjs'].includes(path.extname(file))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(moduleSpecifierPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const relative = path.relative(projectRoot, resolved);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${path.relative(projectRoot, file)} 引用了项目外模块：${specifier}`);
    }
  }
}

console.log('[independence-tests] 通过；五页作用域、宿主隔离、项目内依赖与禁用材料边界均成立');
