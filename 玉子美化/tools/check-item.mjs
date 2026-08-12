import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkPresetFile } from './check-preset.mjs';

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export async function checkPresetItem({ file, itemId, tablesFile = null } = {}) {
  return checkPresetFile({ file, itemId, tablesFile });
}

async function main() {
  const [file, itemId, tablesFile, ...extra] = process.argv.slice(2);
  if (!file || !itemId || extra.length > 0) {
    throw new Error('用法：node tools/check-item.mjs <preset.json> <itemId> [tables.json]');
  }
  const result = await checkPresetItem({ file, itemId, tablesFile });
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`[check-item] Bundle item 检查通过：${itemId}`);
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    console.error(`[check-item] 失败：${error.message}`);
    process.exitCode = 1;
  }
}
