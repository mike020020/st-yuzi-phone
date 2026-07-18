const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const url = file => `${pathToFileURL(path.join(process.cwd(), file)).href}?t=${Date.now()}-${Math.random()}`;

async function main() {
    const paths = await import(url('modules/content-presets/paths.js'));
    const matcher = await import(url('modules/content-presets/matcher.js'));
    const assets = await import(url('modules/content-presets/asset-runtime.js'));
    const contexts = await import(url('modules/content-presets/runtime-context.js'));

    assert.equal(matcher.normalizeMatchText('  ＡＢＣ  '), 'ABC');
    assert.equal(matcher.matchesPresetItem({ target: { tableName: '角色表', fields: ['姓名', '状态'] } }, { tableName: ' 角色表 ', headers: ['状态', '姓名', '备注'] }), true);
    assert.equal(matcher.matchesPresetItem({ target: { tableName: '角色表', fields: ['缺失'] } }, { tableName: '角色表', headers: ['姓名'] }), false);
    assert.throws(() => paths.normalizePackagePath('../x.js'));
    assert.throws(() => paths.resolvePackageReference('pages/a.html', '../../x.png'));
    assert.equal(paths.resolvePackageReference('pages/a.html', '../img/a.png?v=2#x'), 'img/a.png');

    const created = [];
    const revoked = [];
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => { const value = `blob:test-${created.length + 1}`; created.push(value); return value; };
    URL.revokeObjectURL = value => revoked.push(value);
    try {
        const runtime = assets.createAssetRuntime({ files: { 'img/a.svg': { encoding: 'text', content: '<svg/>', mimeType: 'image/svg+xml' } } });
        assert.equal(runtime.rewriteHtml('<img src = "../img/a.svg?v=2#icon">', 'pages/a.html'), '<img src="blob:test-1?v=2#icon">');
        assert.equal(runtime.rewriteCss('a{background:url(../img/a.svg#icon)}', 'pages/a.css'), 'a{background:url(blob:test-1#icon)}');
        assert.equal(created.length, 1, '同一包路径必须复用 Object URL');
        runtime.dispose();
        assert.deepEqual(revoked, ['blob:test-1']);
    } finally {
        URL.createObjectURL = oldCreate;
        URL.revokeObjectURL = oldRevoke;
    }

    global.CustomEvent ||= class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
    global.window = {};
    const a = contexts.createContentPresetRuntimeContext({ token: 'a', snapshot: { sheetKey: 'a', headers: [], rows: [] } });
    const b = contexts.createContentPresetRuntimeContext({ token: 'b', snapshot: { sheetKey: 'b', headers: [], rows: [] } });
    const cleanA = contexts.registerContentPresetContext(a);
    const cleanB = contexts.registerContentPresetContext(b);
    assert.equal(window.__YUZI_BEAUTIFY_CURRENT_CONTEXT__, b);
    cleanB();
    assert.equal(window.__YUZI_BEAUTIFY_CURRENT_CONTEXT__, a);
    cleanB();
    cleanA();
    assert.equal('__YUZI_BEAUTIFY_CURRENT_CONTEXT__' in window, false);

    console.log('[content-presets-core-check] 检查通过');
}

main().catch(error => { console.error('[content-presets-core-check] 检查失败'); console.error(error); process.exitCode = 1; });
