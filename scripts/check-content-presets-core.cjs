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
    for (const invalidPath of [' a.js', 'a.js ', 'a\tb.js', 'a\0b.js', 'a\x7fb.js']) assert.throws(() => paths.normalizePackagePath(invalidPath));

    const created = [];
    const revoked = [];
    class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options.type; } }
    const runtime = assets.createAssetRuntime({ files: {
        'img/a.svg': { encoding: 'text', content: '<svg id="a"/>', mimeType: 'image/svg+xml' },
        'img/a)b.svg': { encoding: 'text', content: '<svg id="paren"/>', mimeType: 'image/svg+xml' },
        'img/b.svg': { encoding: 'text', content: '<svg id="b"/>', mimeType: 'image/svg+xml' },
        'img/c.svg': { encoding: 'text', content: '<svg id="c"/>', mimeType: 'image/svg+xml' },
    } }, {
        BlobCtor: FakeBlob,
        createObjectURL: () => { const value = `blob:test-${created.length + 1}`; created.push(value); return value; },
        revokeObjectURL: value => revoked.push(value),
    });

    for (const badCss of [
        'a{x:url(foo(url(../img/a.svg))}',
        'a{x:url("bad"x url(../img/a.svg))}',
        'a{x:url(../img/a.svg "bad" url(../img/a.svg))}',
    ]) assert.equal(runtime.rewriteCss(badCss, 'pages/a.css'), badCss, `bad-url 必须整体保持：${badCss}`);
    assert.equal(created.length, 0, 'bad-url 内部外观文本不得创建 Object URL');

    assert.equal(runtime.rewriteHtml('<img src = "../img/a.svg?v=2#icon">', 'pages/a.html'), '<img src="blob:test-1?v=2#icon">');
    assert.equal(runtime.rewriteCss('a{background:url(../img/a.svg#icon)}', 'pages/a.css'), 'a{background:url("blob:test-1#icon")}');
    assert.equal(runtime.rewriteCss(String.raw`a{background:u\72l(../img/a.svg?q=1#icon)}`, 'pages/a.css'), 'a{background:url("blob:test-1?q=1#icon")}');
    assert.equal(runtime.rewriteCss(String.raw`a{background:url(../img/a\29 b.svg?q=1#icon)}`, 'pages/a.css'), 'a{background:url("blob:test-2?q=1#icon")}');
    assert.equal(runtime.rewriteCss(String.raw`a{mask:url("../img/a\29 b.svg?q=2#mask")}`, 'pages/a.css'), 'a{mask:url("blob:test-2?q=2#mask")}');
    assert.equal(created.length, 2, '转义右括号路径必须安全解析、quoted 输出并按 package path 缓存');

    for (const unchanged of [
        'a{x:myurl(../img/a.svg)}',
        'a{x:curl(../img/a.svg)}',
        'a{x:url/**/(../img/a.svg)}',
        'a{x:url(data:image/svg+xml,abc)}',
        'a{x:url(blob:test)}',
        'a{x:url(#icon)}',
        'a{x:url(/img/a.svg)}',
        'a{x:"url(../img/a.svg)"}',
        '/* url(../img/a.svg) */',
    ]) assert.equal(runtime.rewriteCss(unchanged, 'pages/a.css'), unchanged, `不得改写：${unchanged}`);

    const badStringBreaks = ['\n', '\r', '\r\n', '\f'];
    for (const lineBreak of badStringBreaks) {
        const css = `a{x:"bad${lineBreak}}b{y:url(../img/b.svg)}`;
        assert.equal(runtime.rewriteCss(css, 'pages/a.css'), `a{x:"bad${lineBreak}}b{y:url("blob:test-3")}`);
    }
    for (const continuation of ['\\\n', '\\\r', '\\\r\n', '\\\f']) {
        const css = `a{x:"kept${continuation}url(../img/c.svg)"}`;
        assert.equal(runtime.rewriteCss(css, 'pages/a.css'), css, 'escaped newline continuation 不得恢复顶层扫描');
    }
    assert.equal(created.length, 3, '合法资源按 package path 缓存，字符串与 bad-url 不得产生副作用');
    runtime.dispose();
    runtime.dispose();
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2', 'blob:test-3'], '重复 dispose 不得重复 revoke');
    assert.equal(runtime.rewriteCss('a{x:url(../img/a.svg)}', 'pages/a.css'), 'a{x:url("blob:test-4")}');
    runtime.dispose();
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2', 'blob:test-3', 'blob:test-4'], 'dispose 后缓存必须清空并可重新创建 URL');

    global.window = {};
    const controller = contexts.createContentPresetRuntimeContextController({
        root: {},
        initialState: Object.freeze({ version: 1, sheetKey: 'a', headers: [], rows: [] }),
        actions: {},
    });
    let delivered = 0;
    const unsubscribe = controller.context.subscribe(() => { delivered += 1; });
    assert.equal(controller.publish(Object.freeze({ version: 1 })), false, '相同 version 不得重复投递');
    assert.equal(controller.publish(Object.freeze({ version: 2 }), 'table-data'), true);
    assert.equal(delivered, 1);
    unsubscribe();
    unsubscribe();
    controller.dispose();
    assert.equal(controller.publish(Object.freeze({ version: 3 })), false, 'dispose 后不得继续投递');
    assert.equal('__YUZI_BEAUTIFY_CURRENT_CONTEXT__' in window, false);

    console.log('[content-presets-core-check] 检查通过');
}

main().catch(error => { console.error('[content-presets-core-check] 检查失败'); console.error(error); process.exitCode = 1; });
