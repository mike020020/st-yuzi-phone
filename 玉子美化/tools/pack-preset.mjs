import fs from 'node:fs/promises';
import path from 'node:path';
import { buildBundle, serializeBundle } from './lib.mjs';

const [projectFile, outputFile] = process.argv.slice(2);
if (!projectFile || !outputFile) throw new Error('用法：node tools/pack-preset.mjs <project.json> <output.json>');
const bundle = await buildBundle(projectFile);
await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, serializeBundle(bundle), 'utf8');
console.log(`[pack-preset] 已输出：${outputFile}`);
