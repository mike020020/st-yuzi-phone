import { normalizeTables, readJson, validateBundle } from './lib.mjs';
const [file, itemId, tablesFile] = process.argv.slice(2);
if (!file || !itemId) throw new Error('用法：node tools/check-item.mjs <preset.json> <itemId> [tables.json]');
const bundle = await readJson(file);
const item = bundle?.manifest?.items?.find(entry => entry.id === itemId);
if (!item) throw new Error(`item 不存在：${itemId}`);
const tables = tablesFile ? normalizeTables(await readJson(tablesFile)) : null;
const result = validateBundle({ ...bundle, manifest: { ...bundle.manifest, items: [item] } }, { strict: true, tables });
if (!result.ok) { console.error(result.errors.join('\n')); process.exitCode = 1; } else console.log(`[check-item] 通过：${itemId}`);
