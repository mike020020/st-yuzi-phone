import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDirectory = path.resolve(here, '../schemas');
const schemaFiles = Object.freeze({
  bundle: 'yuzi-beautify.schema.json',
  project: 'project.schema.json',
  workflow: 'workflow-state.schema.json',
});

const ajv = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' });
const validators = new Map(Object.entries(schemaFiles).map(([kind, file]) => {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, file), 'utf8'));
  return [kind, ajv.compile(schema)];
}));

function formatError(error) {
  const location = error.dataPath || '/';
  return `${location} ${error.message}`;
}

export function validateSchema(kind, value) {
  const validator = validators.get(kind);
  if (!validator) throw new Error(`未知 Schema 类型：${kind}`);
  const ok = validator(value);
  return {
    ok: Boolean(ok),
    errors: ok ? [] : (validator.errors || []).map(formatError),
  };
}

export function assertSchema(kind, value, label = kind) {
  const result = validateSchema(kind, value);
  if (!result.ok) throw new Error(`${label} 结构校验失败：\n${result.errors.join('\n')}`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, inputFile] = process.argv.slice(2);
  if (!kind || !inputFile) throw new Error('用法：node tools/schema-validator.mjs <bundle|project|workflow> <json文件>');
  const value = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf8'));
  assertSchema(kind, value, inputFile);
  console.log(`[schema] ${kind} 通过：${inputFile}`);
}
