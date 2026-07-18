import fs from 'node:fs/promises';
import { buildBundle, fileBytes, hash, readJson, serializeBundle, validateBundle } from './lib.mjs';

const [projectFile, file] = process.argv.slice(2);
if (!projectFile || !file) throw new Error('用法：node tools/readback-preset.mjs <project.json> <preset.json>');
const raw = await fs.readFile(file, 'utf8');
const bundle = await readJson(file);
const result = validateBundle(bundle, { strict: true });
if (!result.ok) throw new Error(result.errors.join('\n'));
const expected = await buildBundle(projectFile);
const expectedRaw = serializeBundle(expected);
if (raw !== expectedRaw) {
  const expectedNames = Object.keys(expected.files);
  const actualNames = Object.keys(bundle.files);
  const details = [...new Set([...expectedNames, ...actualNames])].map((name) => {
    const wanted = expected.files[name];
    const actual = bundle.files[name];
    return {
      name,
      expected: wanted ? { encoding: wanted.encoding, mimeType: wanted.mimeType, sha256: hash(fileBytes(wanted)) } : null,
      actual: actual ? { encoding: actual.encoding, mimeType: actual.mimeType, sha256: hash(fileBytes(actual)) } : null,
    };
  });
  throw new Error(`回读与 project/source 不一致：\n${JSON.stringify(details, null, 2)}`);
}
const files = Object.entries(bundle.files).map(([name, entry]) => {
  const bytes = fileBytes(entry);
  return { name, encoding: entry.encoding, byteLength: bytes.length, sha256: hash(bytes) };
});
console.log(JSON.stringify({ presetId: bundle.manifest.id, itemCount: bundle.manifest.items.length, bundleSha256: hash(Buffer.from(raw, 'utf8')), serializedBytesEqual: true, files }, null, 2));
