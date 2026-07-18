import { normalizeTables, readJson, validateBundle } from './lib.mjs';
const [file, tablesFile] = process.argv.slice(2);
if (!file) throw new Error('用法：node tools/check-preset.mjs <preset.json>');
const tables = tablesFile ? normalizeTables(await readJson(tablesFile)) : null;
const result = validateBundle(await readJson(file), { strict: true, tables });
if (!result.ok) { console.error(result.errors.join('\n')); process.exitCode = 1; } else console.log(`[check-preset] 通过：${file}`);
