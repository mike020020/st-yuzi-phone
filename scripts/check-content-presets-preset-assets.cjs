const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const turn = () => new Promise(resolve => setImmediate(resolve));

async function main() {
    const moduleUrl = `${pathToFileURL(path.resolve('modules/content-presets/preset-assets.js')).href}?t=${Date.now()}`;
    const contextUrl = `${pathToFileURL(path.resolve('modules/content-presets/runtime-context.js')).href}?t=${Date.now()}`;
    const { createPresetAssetsRuntime } = await import(moduleUrl);
    const { createContentPresetRuntimeContextController } = await import(contextUrl);
    const record = { files: {} };
    const created = [];
    const revoked = [];
    const writes = [];
    const decodeStarts = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    let commitCalls = 0;
    const runtime = createPresetAssetsRuntime('preset-a', {
        BlobCtor: Blob,
        createObjectURL(blob) {
            const url = `blob:test-${created.length + 1}`;
            created.push({ url, blob });
            return url;
        },
        revokeObjectURL: url => revoked.push(url),
        async decodeImage(blob) {
            const value = await blob.text();
            decodeStarts.push(value);
            if (value === 'first') await firstGate;
            if (value === 'broken') throw new Error('fixture decode failed');
        },
        getPresetRecord: async () => record,
        updatePresetFiles: async (_presetId, patch) => {
            writes.push(structuredClone(patch));
            for (const filePath of patch.removePaths) delete record.files[filePath];
            if (patch.file) record.files[patch.file.path] = structuredClone(patch.file);
            return record;
        },
        enqueueContentPresetMutation: async (operation, commit) => {
            const result = await operation();
            await commit(result, {});
            commitCalls += 1;
            return result;
        },
    });

    const slot = ' 角色/头像 ';
    const basePath = `user-assets/${encodeURIComponent(slot)}`;
    const firstPath = `${basePath}.png`;
    const secondPath = `${basePath}.jpg`;
    assert.equal(await runtime.getUrl(slot), null);
    await assert.rejects(() => runtime.getUrl('   '), /资源槽不能为空/);
    await assert.rejects(() => runtime.save('broken', new Blob(['broken'], { type: 'text/plain' })), /fixture decode failed/);
    assert.equal(writes.length, 0, '解码失败不得写入预设');

    const first = runtime.save(slot, new Blob(['first'], { type: 'image/png' }));
    const second = runtime.save(slot, new Blob(['second'], { type: 'image/jpeg' }));
    await turn();
    assert.deepEqual(decodeStarts, ['broken', 'first'], '同槽后调用必须等待前调用完成');
    releaseFirst();
    const [firstUrl, secondUrl] = await Promise.all([first, second]);
    assert.equal(firstUrl, 'blob:test-1');
    assert.equal(secondUrl, 'blob:test-2');
    assert.equal(writes[0].file.path, firstPath);
    assert.equal(writes[1].file.path, secondPath);
    assert.equal(record.files[firstPath], undefined, '跨格式替换必须清理旧扩展文件');
    assert.equal(Buffer.from(record.files[secondPath].content, 'base64').toString(), 'second', '同槽后保存必须最终生效');
    assert.deepEqual(revoked, ['blob:test-1'], '替换图片必须撤销旧 URL');
    assert.equal(await runtime.getUrl(slot), secondUrl, '已缓存图片不得重复创建 URL');

    await runtime.delete(slot);
    assert.equal(record.files[secondPath], undefined);
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2'], '删除图片必须撤销当前 URL');
    await runtime.delete(slot);
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2'], '幂等删除不得重复撤销 URL');

    record.files[`${basePath}.image`] = { path: `${basePath}.image`, mimeType: 'image/x-test', encoding: 'base64', content: Buffer.from('persisted').toString('base64') };
    assert.equal(await runtime.getUrl(slot), 'blob:test-3');
    assert.equal(await created.at(-1).blob.text(), 'persisted');

    const contextController = createContentPresetRuntimeContextController({ initialState: { version: 1 }, presetAssets: runtime });
    assert.strictEqual(contextController.context.presetAssets, runtime, 'Runtime context 必须公开同一个 presetAssets API');

    runtime.dispose();
    runtime.dispose();
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2', 'blob:test-3'], 'dispose 必须且只能撤销一次剩余 URL');
    await assert.rejects(() => runtime.getUrl(slot), /运行时已失效/);
    assert.equal(commitCalls, 4, '两次保存和两次删除必须走 mutation coordinator');

    console.log('[content-presets-preset-assets-check] 检查通过');
}

main().catch(error => {
    console.error('[content-presets-preset-assets-check] 检查失败');
    console.error(error);
    process.exitCode = 1;
});
