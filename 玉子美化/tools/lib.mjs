import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'yuzi-beautify-preset';
export const VERSION = 1;
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); };
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const compareCodeUnits = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const DRIVE_PATTERN = /^[a-z]:/i;

export const normalizeMatchText = value => String(value ?? '').normalize('NFKC').trim();

export function normalizePackagePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('包路径不能为空');
  if (/[\\?#\0-\x1f\x7f]/.test(raw)) throw new Error(`包路径包含非法字符：${raw}`);
  if (raw.startsWith('/') || DRIVE_PATTERN.test(raw) || SCHEME_PATTERN.test(raw)) throw new Error(`包路径必须是相对路径：${raw}`);
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`包路径包含无效段：${raw}`);
  return segments.join('/');
}

export function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('内容不是规范 Base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('内容不是规范 Base64');
  return bytes;
}

function isMessageTableName(value) {
  return normalizeMatchText(value) === '消息记录表';
}

export function normalizeTables(input) {
  if (!isObject(input)) throw new Error('表数据必须是对象或包含 chatSheets/sheets');
  const source = isObject(input.chatSheets) ? input.chatSheets : isObject(input.sheets) ? input.sheets : input;
  const shujukuRoot = input === source && input?.mate?.type === 'chatSheets';
  return Object.entries(source).filter(([sheetKey, sheet]) => {
    if (!isObject(sheet)) return false;
    if (shujukuRoot) return sheetKey.startsWith('sheet_') && Array.isArray(sheet.content);
    return Array.isArray(sheet.content) || Array.isArray(sheet.rows);
  }).map(([sheetKey, sheet]) => {
    const content = Array.isArray(sheet?.content) ? sheet.content : Array.isArray(sheet?.rows) ? [sheet.headers || [], ...sheet.rows] : [];
    const headers = Array.isArray(content[0]) ? content[0].map(value => String(value ?? '').trim()) : [];
    const tableName = String(sheet?.name || sheet?.tableName || sheetKey).trim();
    const isMessage = normalizeMatchText(sheet?.specialType).toLowerCase() === 'message' || isMessageTableName(tableName);
    return { sheetKey, tableName, headers, rows: content.slice(1).filter(Array.isArray), specialType: isMessage ? 'message' : String(sheet?.specialType || ''), isMessage };
  });
}

export function matchesItemToTable(item, table) {
  if (table?.isMessage || normalizeMatchText(table?.specialType).toLowerCase() === 'message' || isMessageTableName(table?.tableName)) return false;
  if (normalizeMatchText(item?.target?.tableName) !== normalizeMatchText(table?.tableName)) return false;
  const actualFields = new Set((table?.headers || []).map(normalizeMatchText).filter(Boolean));
  return (item?.target?.fields || []).map(normalizeMatchText).every(field => actualFields.has(field));
}

function validateFields(fields, prefix, errors) {
  if (!Array.isArray(fields)) { errors.push(`${prefix} 必须是数组`); return; }
  if (fields.length === 0) errors.push(`${prefix} 至少需要一个字段`);
  const seen = new Set();
  fields.forEach((field, index) => {
    if (typeof field !== 'string' || !normalizeMatchText(field)) { errors.push(`${prefix}[${index}] 必须是非空字符串`); return; }
    const normalized = normalizeMatchText(field);
    if (seen.has(normalized)) errors.push(`${prefix} NFKC 规范化后重复：${normalized}`);
    seen.add(normalized);
  });
}

export function validateBundle(bundle, { strict = true, tables = null } = {}) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) errors.push('Bundle 必须是对象');
  if (bundle?.format !== FORMAT) errors.push(`format 必须为 ${FORMAT}`);
  if (Number(bundle?.formatVersion) !== VERSION) errors.push(`formatVersion 必须为 ${VERSION}`);
  if (!isObject(bundle?.manifest)) errors.push('manifest 必须是对象');
  if (!isObject(bundle?.files)) errors.push('files 必须是对象');
  const files = isObject(bundle?.files) ? bundle.files : {};
  const normalizedFiles = new Set();
  for (const [filePath, file] of Object.entries(files)) {
    let normalized;
    try { normalized = normalizePackagePath(filePath); } catch (error) { errors.push(error.message); continue; }
    if (normalizedFiles.has(normalized)) errors.push(`包路径规范化后重复：${normalized}`);
    normalizedFiles.add(normalized);
    if (!isObject(file)) { errors.push(`files.${filePath} 必须是对象`); continue; }
    if (!String(file.mimeType || '').trim()) errors.push(`files.${filePath}.mimeType 缺失`);
    if (!['text', 'base64'].includes(file.encoding)) errors.push(`files.${filePath}.encoding 无效`);
    if (typeof file.content !== 'string') errors.push(`files.${filePath}.content 必须是字符串`);
    if (file.encoding === 'base64' && typeof file.content === 'string') {
      try { decodeCanonicalBase64(file.content); } catch { errors.push(`files.${filePath}.content 不是规范 Base64`); }
    }
  }
  const items = Array.isArray(bundle?.manifest?.items) ? bundle.manifest.items : [];
  if (strict && !String(bundle?.manifest?.id || '').trim()) errors.push('严格模式要求 manifest.id');
  if (strict && items.length === 0) errors.push('严格模式要求至少一个 item');
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const prefix = `items[${index}]`;
    const id = String(item?.id || '').trim();
    if (!id) errors.push(`${prefix}.id 缺失`); else if (ids.has(id)) errors.push(`${prefix}.id 重复`); else ids.add(id);
    if (!String(item?.target?.tableName || '').trim()) errors.push(`${prefix}.target.tableName 缺失`);
    validateFields(item?.target?.fields, `${prefix}.target.fields`, errors);
    const entries = ['html', 'css', 'js'].filter(key => item?.entry?.[key]);
    if (strict && entries.length === 0) errors.push(`${prefix} 至少需要 html/css/js 入口`);
    for (const key of entries) {
      let entryPath;
      try { entryPath = normalizePackagePath(item.entry[key]); } catch (error) { errors.push(`${prefix}.entry.${key}: ${error.message}`); continue; }
      if (!hasOwn(files, entryPath)) errors.push(`${prefix}.entry.${key} 文件不存在`);
    }
    if (item?.entry?.scriptMode && !['classic', 'module'].includes(item.entry.scriptMode)) errors.push(`${prefix}.entry.scriptMode 无效`);
    if (item?.assets !== undefined && !Array.isArray(item.assets)) errors.push(`${prefix}.assets 必须是数组`);
    const assets = Array.isArray(item?.assets) ? item.assets : [];
    const assetPaths = new Set();
    for (const [assetIndex, asset] of assets.entries()) {
      let assetPath;
      try { assetPath = normalizePackagePath(asset); } catch (error) { errors.push(`${prefix}.assets[${assetIndex}]: ${error.message}`); continue; }
      if (assetPaths.has(assetPath)) errors.push(`${prefix}.assets 重复：${assetPath}`);
      assetPaths.add(assetPath);
      if (!hasOwn(files, assetPath)) errors.push(`${prefix}.assets[${assetIndex}] 文件不存在`);
    }
    if (strict && Array.isArray(tables) && !tables.some(table => matchesItemToTable(item, table))) errors.push(`${prefix} 未匹配任何真实非消息表`);
  }
  return { ok: errors.length === 0, errors };
}

async function resolveProjectFile(root, source, label) {
  const raw = String(source ?? '').trim();
  if (!raw || raw.includes('\\') || path.isAbsolute(raw) || DRIVE_PATTERN.test(raw) || SCHEME_PATTERN.test(raw) || raw.includes('\0')) throw new Error(`${label} 必须是项目内相对路径`);
  const rootReal = await fs.realpath(root);
  const candidate = path.resolve(rootReal, raw);
  const lexicalRelative = path.relative(rootReal, candidate);
  if (!lexicalRelative || lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) throw new Error(`${label} 越出项目目录：${raw}`);
  const fileReal = await fs.realpath(candidate);
  const relative = path.relative(rootReal, fileReal);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} 越出项目目录：${raw}`);
  const stat = await fs.stat(fileReal);
  if (!stat.isFile()) throw new Error(`${label} 不是普通文件：${raw}`);
  return fileReal;
}

function canonicalManifest(manifest = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    items: (Array.isArray(manifest.items) ? manifest.items : []).map(item => ({
      id: item.id,
      name: item.name,
      target: { tableName: item.target?.tableName, fields: item.target?.fields },
      entry: {
        ...(item.entry?.html ? { html: item.entry.html } : {}),
        ...(item.entry?.css ? { css: item.entry.css } : {}),
        ...(item.entry?.js ? { js: item.entry.js } : {}),
        ...(item.entry?.scriptMode ? { scriptMode: item.entry.scriptMode } : {}),
      },
      assets: Array.isArray(item.assets) ? item.assets : [],
    })),
  };
}

export async function buildBundle(projectFile) {
  const projectPath = projectFile instanceof URL ? fileURLToPath(projectFile) : path.resolve(String(projectFile));
  const project = await readJson(projectPath);
  const root = path.dirname(projectPath);
  if (!String(project.tablesFile || '').trim()) throw new Error('project.tablesFile 缺失');
  const tablesPath = await resolveProjectFile(root, project.tablesFile, 'tablesFile');
  const tables = normalizeTables(await readJson(tablesPath));
  const fileEntries = [];
  const packagePaths = new Set();
  for (const [rawPackagePath, source] of Object.entries(project.files || {})) {
    const packagePath = normalizePackagePath(rawPackagePath);
    if (packagePaths.has(packagePath)) throw new Error(`包路径规范化后重复：${packagePath}`);
    packagePaths.add(packagePath);
    const encoding = project.encodings?.[rawPackagePath] || 'text';
    if (!['text', 'base64'].includes(encoding)) throw new Error(`${packagePath} encoding 无效`);
    const sourcePath = await resolveProjectFile(root, source, `files.${packagePath}`);
    const bytes = await fs.readFile(sourcePath);
    let content;
    if (encoding === 'base64') content = bytes.toString('base64');
    else content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    fileEntries.push([packagePath, { mimeType: project.mimeTypes?.[rawPackagePath] || 'application/octet-stream', encoding, content }]);
  }
  const files = Object.fromEntries(fileEntries.sort(([a], [b]) => compareCodeUnits(a, b)));
  const bundle = { format: FORMAT, formatVersion: VERSION, manifest: canonicalManifest(project.manifest), files };
  const result = validateBundle(bundle, { strict: true, tables });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return bundle;
}

export const serializeBundle = bundle => `${JSON.stringify(bundle, null, 2)}\n`;

export function fileBytes(file) {
  if (file.encoding === 'base64') return decodeCanonicalBase64(file.content);
  return Buffer.from(file.content, 'utf8');
}
