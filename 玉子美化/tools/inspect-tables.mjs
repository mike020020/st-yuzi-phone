import { normalizeTables, readJson } from './lib.mjs';
const file = process.argv[2];
if (!file) throw new Error('用法：node tools/inspect-tables.mjs <tables.json>');
const tables = normalizeTables(await readJson(file));
console.log(JSON.stringify(tables.map(({ sheetKey, tableName, headers, rows, specialType }) => ({ sheetKey, tableName, headers, rowCount: rows.length, specialType })), null, 2));
