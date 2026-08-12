const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const url = file => `${pathToFileURL(path.join(process.cwd(), file)).href}?t=${Date.now()}-${Math.random()}`;
const baseBundle = () => ({
    format: 'yuzi-beautify-preset',
    formatVersion: 2,
    apiVersion: 1,
    manifest: {
        id: 'preset-v2', name: 'V2', items: [{
            id: 'item-v2', name: '角色表', target: { tableName: '角色表', fields: ['姓名'] },
            entry: { html: 'pages/page.html', css: 'pages/page.css', mount: 'pages/main.mjs' },
        }],
    },
    files: {
        'pages/page.html': { mimeType: 'text/html', encoding: 'text', content: '<main></main>' },
        'pages/page.css': { mimeType: 'text/css', encoding: 'text', content: '' },
        'pages/main.mjs': { mimeType: 'text/javascript', encoding: 'text', content: 'export function mount(context) {}' },
    },
});

async function main() {
    const { importContentPreset, exportContentPreset, readbackContentPreset } = await import(url('modules/content-presets/import-export.js'));
    const { isTrustedContentPresetRecord, parseContentPresetBundle } = await import(url('modules/content-presets/format.js'));
    const record = importContentPreset(baseBundle());
    assert.equal(record.formatVersion, 2);
    assert.equal(record.apiVersion, 1);
    assert.deepEqual(record.items[0].entry, { html: 'pages/page.html', css: 'pages/page.css', mount: 'pages/main.mjs' });
    assert.equal(record.items[0].activatable, true);
    assert.deepEqual(exportContentPreset(record).apiVersion, 1);
    assert.equal(readbackContentPreset(record).record.items[0].entry.mount, 'pages/main.mjs');

    for (const mutate of [
        bundle => { bundle.extra = true; },
        bundle => { bundle.id = 'trusted-record-only'; },
        bundle => { bundle.manifest.extra = true; },
        bundle => { bundle.manifest.items[0].extra = true; },
        bundle => { bundle.manifest.items[0].target.extra = true; },
        bundle => { bundle.manifest.items[0].entry.extra = true; },
        bundle => { bundle.files['pages/main.mjs'].extra = true; },
        bundle => { bundle.formatVersion = 1; },
        bundle => { delete bundle.apiVersion; },
        bundle => { bundle.apiVersion = 2; },
        bundle => { bundle.formatVersion = '2'; },
        bundle => { bundle.apiVersion = '1'; },
        bundle => { bundle.formatVersion = true; },
        bundle => { bundle.apiVersion = null; },
        bundle => { bundle.formatVersion = []; },
        bundle => { bundle.apiVersion = {}; },
        bundle => { bundle.manifest.items[0].entry.scriptMode = 'module'; },
        bundle => { bundle.manifest.items[0].entry.js = 'pages/legacy.js'; },
        bundle => { delete bundle.manifest.items[0].entry.mount; },
        bundle => { bundle.manifest.items[0].entry.mount = '../main.mjs'; },
        bundle => { bundle.manifest.items[0].entry.mount = 'pages/missing.mjs'; },
        bundle => { bundle.files['pages/main.mjs'].encoding = 'base64'; },
        bundle => { bundle.files['pages/main.mjs'].mimeType = 'text/plain'; },
        bundle => { bundle.files['pages/main.mjs'].content = 'export function start() {}'; },
        bundle => { bundle.files['pages/main.mjs'].content = '// export function mount(context) {}'; },
        bundle => { bundle.files['pages/main.mjs'].content = "const source = 'export function mount(context) {}';"; },
        bundle => { bundle.files['pages/main.mjs'].content = 'export function mount() {}'; },
        bundle => { bundle.files['pages/main.mjs'].content = 'export const mount = context => {}'; },
        bundle => { bundle.manifest.items[0].scriptMode = 'module'; },
        bundle => { bundle.files['pages/page.html'].encoding = 'base64'; },
        bundle => { bundle.files['pages/page.html'].mimeType = 'application/octet-stream'; },
        bundle => { bundle.files['pages/page.css'].encoding = 'base64'; },
        bundle => { bundle.files['pages/page.css'].mimeType = 'image/png'; },
        bundle => { bundle.files['../escape.txt'] = { mimeType: 'text/plain', encoding: 'text', content: 'x' }; },
    ]) {
        const bundle = baseBundle();
        mutate(bundle);
        assert.throws(() => importContentPreset(bundle));
    }
    assert.throws(() => parseContentPresetBundle(record), 'trusted record 不得被 raw Bundle parser 接受');
    assert.equal(isTrustedContentPresetRecord(record), true);

    for (const mutateRecord of [
        value => { value.extra = true; },
        value => { value.manifest.extra = true; },
        value => { value.items[0].extra = true; },
        value => { value.items[0].target.extra = true; },
        value => { value.items[0].entry.extra = true; },
        value => { value.files['pages/main.mjs'].extra = true; },
        value => { value.items[0].entry.mount = '../pages/main.mjs'; value.files['../pages/main.mjs'] = value.files['pages/main.mjs']; },
        value => { value.items[0].entry.mount = 'pages\\main.mjs'; value.files['pages\\main.mjs'] = value.files['pages/main.mjs']; },
        value => { value.items[0].entry.mount = ' pages/main.mjs'; value.files[' pages/main.mjs'] = value.files['pages/main.mjs']; },
        value => { value.items[0].entry.html = '/pages/page.html'; value.files['/pages/page.html'] = value.files['pages/page.html']; },
        value => { value.files['../escape.txt'] = { mimeType: 'text/plain', encoding: 'text', content: 'x' }; },
        value => { value.items[0].entry.html = 'pages/page.html'; value.files['pages/page.html'] = { mimeType: 'application/octet-stream', encoding: 'base64', content: 'x' }; },
        value => { value.items[0].scriptMode = 'module'; },
    ]) {
        const candidate = structuredClone(record);
        mutateRecord(candidate);
        assert.equal(isTrustedContentPresetRecord(candidate), false, 'repository trust predicate 必须拒绝非规范化 entry path');
    }

    console.log('[content-presets-v2-contract-check] 检查通过');
}

main().catch(error => { console.error('[content-presets-v2-contract-check] 检查失败'); console.error(error); process.exitCode = 1; });
