import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { normalizeTables, readJson, validateBundle } from './lib.mjs';
import { checkWorkflowProject, loadWorkflowProject } from './project-lib.mjs';

const GENERATED_TABLES_FILE = /^tables\/generated\/(?:[^/]+\/)*[^/]+\.json$/;

function formatErrors(prefix, errors) {
  return `${prefix}：\n${errors.map(error => `- ${error}`).join('\n')}`;
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

/**
 * 验证现成 Bundle。这个入口只检查 Bundle v2 / Runtime API v1 合同，
 * 不读取源码项目，也不代表用户已经确认发布。
 */
export async function checkPresetFile({ file, tablesFile = null, itemId = null } = {}) {
  if (!file) throw new Error('Bundle 文件不能为空');
  const bundle = await readJson(file);
  let candidate = bundle;
  if (itemId !== null) {
    if (typeof itemId !== 'string' || !itemId.trim()) throw new Error('itemId 不能为空');
    const item = bundle?.manifest?.items?.find(entry => entry.id === itemId);
    if (!item) throw new Error(`item 不存在：${itemId}`);
    candidate = { ...bundle, manifest: { ...bundle.manifest, items: [item] } };
  }
  const tables = tablesFile ? normalizeTables(await readJson(tablesFile)) : null;
  const result = validateBundle(candidate, { strict: true, tables });
  return { ...result, file, itemId };
}

/**
 * 验证源码项目是否可以进入正式打包或回读。
 * Bundle 文件的独立检查不能调用或替代这个发布门禁。
 */
export async function assertProjectRelease(projectFile) {
  if (!projectFile) throw new Error('源码项目文件不能为空');
  const result = await checkWorkflowProject(projectFile, { mode: 'release', requireConfirmation: true });
  if (!result.ok) throw new Error(formatErrors('源码项目未通过发布门禁', result.errors));

  const context = await loadWorkflowProject(projectFile);
  const tablesFile = context.project.tablesFile;
  if (!GENERATED_TABLES_FILE.test(tablesFile)) {
    throw new Error(formatErrors('源码项目未通过发布门禁', [
      `project.json.tablesFile 必须指向项目内 tables/generated/ 下的 chatSheets JSON，当前为：${tablesFile}`,
    ]));
  }

  return {
    ok: true,
    projectFile: context.projectPath,
    projectRoot: context.root,
    tablesFile,
    summary: result.summary,
  };
}

async function main() {
  const [file, tablesFile, ...extra] = process.argv.slice(2);
  if (!file || extra.length > 0) {
    throw new Error('用法：node tools/check-preset.mjs <preset.json> [tables.json]');
  }
  const result = await checkPresetFile({ file, tablesFile });
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`[check-preset] Bundle 检查通过：${file}`);
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    console.error(`[check-preset] 失败：${error.message}`);
    process.exitCode = 1;
  }
}
