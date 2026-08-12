import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as waitImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createRuntimeV1 } from '../preview/runtime-v1.js';
import { startPreviewServer } from '../tools/preview-preset.mjs';

const makeState = (version = 1, patch = {}) => ({
  version,
  sheetKey: 'sheet_character',
  tableName: '角色表',
  headers: ['姓名', '状态'],
  rows: [['玉子', '正常']],
  route: 'preview:table:sheet_character',
  canPrevious: true,
  canNext: true,
  ...patch,
});

const createdUrls = [];
const revokedUrls = [];
const urlApi = {
  createObjectURL() { const value = `blob:fixture-${createdUrls.length + 1}`; createdUrls.push(value); return value; },
  revokeObjectURL(value) { revokedUrls.push(value); },
};
const logs = [];
let actionGateResolve;
const actionGate = new Promise(resolve => { actionGateResolve = resolve; });
let holdAction = true;
const runtime = createRuntimeV1({
  root: {},
  files: {
    'assets/icon.svg': { mimeType: 'image/svg+xml', encoding: 'text', content: '<svg/>' },
    'assets/pixel.png': { mimeType: 'image/png', encoding: 'base64', content: 'iVBORw0KGgo=' },
  },
  initialState: makeState(),
  urlApi,
  BlobCtor: Blob,
  onLog(entry) { logs.push(entry); },
  async onAction(action, result) {
    if (action === 'back' && holdAction) await actionGate;
    return result;
  },
});

assert.equal(runtime.apiVersion, 1);
assert.equal(Object.isFrozen(runtime.getState()), true);
assert.equal(Object.isFrozen(runtime.getState().headers), true);
assert.equal(Object.isFrozen(runtime.getState().rows), true);
assert.equal(Object.isFrozen(runtime.getState().rows[0]), true);
assert.throws(() => { runtime.getState().headers.push('非法'); }, TypeError);

const notifications = [];
const unsubscribe = runtime.subscribe((state, metadata) => notifications.push({ state, metadata }));
assert.equal(notifications.length, 0, 'subscribe 不应立即推送');
assert.equal(runtime.updateState(makeState(1, { tableName: '同版本不应生效' })), false);
assert.equal(runtime.getState().tableName, '角色表');
assert.equal(runtime.updateState(makeState(2, { tableName: '更新角色表' }), { reason: 'table-data' }), true);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].state.tableName, '更新角色表');
assert.equal(notifications[0].metadata.reason, 'table-data');
assert.equal(Object.isFrozen(notifications[0].metadata), true);
assert.throws(() => runtime.updateState(makeState(3), { reason: 'unknown' }), /未知订阅 reason/);
unsubscribe();
unsubscribe();
runtime.updateState(makeState(3), { reason: 'navigation-state' });
assert.equal(notifications.length, 1, '取消订阅后不得继续推送');

const firstAsset = runtime.resolveAsset('assets/icon.svg?q=1#icon');
const secondAsset = runtime.resolveAsset('./assets/icon.svg#two');
assert.equal(firstAsset, 'blob:fixture-1?q=1#icon');
assert.equal(secondAsset, 'blob:fixture-1#two');
assert.equal(runtime.activeObjectUrlCount, 1);
assert.match(runtime.resolveAsset('assets/pixel.png'), /^blob:fixture-2/);
assert.throws(() => runtime.resolveAsset('../outside.png'), /无效段/);
assert.throws(() => runtime.resolveAsset('missing.png'), /不存在/);

const firstBack = runtime.actions.back();
const secondBack = runtime.actions.back();
assert.equal(firstBack, secondBack, '同一 action 并发调用必须复用 pending Promise');
actionGateResolve();
assert.equal((await firstBack).status, 'navigated');
holdAction = false;
runtime.setActionScenario('editCurrentTable', 'stale');
assert.equal((await runtime.actions.editCurrentTable()).status, 'stale');
runtime.setActionScenario('nextTable', 'failed');
assert.equal((await runtime.actions.nextTable()).status, 'failed');
runtime.updateState(makeState(4, { canPrevious: false }));
assert.equal((await runtime.actions.previousTable()).status, 'unavailable', '导航能力为 false 时应强制 unavailable');
assert.throws(() => runtime.setActionScenario('unknown', 'failed'), /未知 action/);
assert.throws(() => runtime.setActionScenario('back', 'unknown'), /未知 action 场景/);

const mountOrder = [];
let firstSignal;
let firstContext;
await runtime.mountModule({
  mount(context) {
    firstContext = context;
    firstSignal = context.signal;
    assert.equal(Object.isFrozen(context), true);
    assert.equal(context.apiVersion, 1);
    assert.equal(Object.isFrozen(context.presetAssets), true);
    context.subscribe(() => {});
    return () => { mountOrder.push('dispose-first'); };
  },
});
assert.equal(firstSignal.aborted, false);
const presetSlot = '重要角色/% 01';
assert.equal(await firstContext.presetAssets.getUrl(presetSlot), null);
const firstPresetUrl = await firstContext.presetAssets.save(presetSlot, new Blob(['first'], { type: 'application/x-preview' }));
assert.equal(await firstContext.presetAssets.getUrl(presetSlot), firstPresetUrl);
const replacementPresetUrl = await firstContext.presetAssets.save(presetSlot, new Blob(['second']));
assert.notEqual(replacementPresetUrl, firstPresetUrl);
assert.equal(revokedUrls.includes(firstPresetUrl), true, '替换同槽图片必须回收旧 Blob URL');
await assert.rejects(() => firstContext.presetAssets.save('', new Blob(['invalid'])), /非空字符串/);
await assert.rejects(() => firstContext.presetAssets.save('not-a-blob', 'invalid'), /必须是 Blob/);
let secondContext;
await runtime.mountModule({ mount(context) { secondContext = context; mountOrder.push('mount-second'); return () => { mountOrder.push('dispose-second'); }; } });
assert.deepEqual(mountOrder.slice(0, 2), ['dispose-first', 'mount-second'], '重新挂载必须先清理旧实例');
assert.equal(firstSignal.aborted, true);
assert.equal(revokedUrls.includes(replacementPresetUrl), true, '旧实例卸载必须回收其 Blob URL');
await assert.rejects(() => firstContext.presetAssets.getUrl(presetSlot), /页面实例已失效/);
const remountedPresetUrl = await secondContext.presetAssets.getUrl(presetSlot);
assert.notEqual(remountedPresetUrl, replacementPresetUrl, '重新挂载后必须为内存图片创建新的 Blob URL');
await secondContext.presetAssets.delete(presetSlot);
assert.equal(revokedUrls.includes(remountedPresetUrl), true, '删除图片必须回收 Blob URL');
assert.equal(await secondContext.presetAssets.getUrl(presetSlot), null);
await secondContext.presetAssets.delete(presetSlot);
await runtime.unmount();
await runtime.unmount();
assert.deepEqual(mountOrder, ['dispose-first', 'mount-second', 'dispose-second']);

let releaseLateMount;
let lateDisposed = 0;
const lateModule = {
  mount() {
    return new Promise(resolve => { releaseLateMount = resolve; });
  },
};
const timeoutRuntime = createRuntimeV1({ root: {}, files: {}, initialState: makeState(), timeoutMs: 15 });
await assert.rejects(() => timeoutRuntime.mountModule(lateModule), error => error?.code === 'MOUNT_TIMEOUT');
releaseLateMount(() => { lateDisposed += 1; });
await waitImmediate();
await waitImmediate();
assert.equal(lateDisposed, 1, '超时后迟到的 disposer 必须立即执行一次');
await timeoutRuntime.destroy();

let abortedSignal;
const abortRuntime = createRuntimeV1({ root: {}, files: {}, initialState: makeState() });
await abortRuntime.mountModule({ mount(context) { abortedSignal = context.signal; return () => {}; } });
await abortRuntime.destroy();
assert.equal(abortedSignal.aborted, true);
await abortRuntime.destroy();
assert.equal(abortRuntime.destroyed, true);

const failureLogs = [];
const failureRuntime = createRuntimeV1({
  root: {},
  files: {},
  initialState: makeState(),
  onLog(entry) { failureLogs.push(entry); },
  onAction() { throw new Error('action boom'); },
});
assert.equal((await failureRuntime.actions.back()).status, 'failed');
await assert.rejects(() => failureRuntime.mountModule({ mount() { throw new Error('mount boom'); } }), /mount boom/);
assert.equal(failureLogs.some(entry => entry.level === 'error'), true);
await failureRuntime.destroy();

await runtime.destroy();
await runtime.destroy();
assert.deepEqual(revokedUrls.sort(), createdUrls.sort(), 'destroy 必须回收全部资源 Blob URL');
assert.equal(runtime.activeObjectUrlCount, 0);
assert.throws(() => runtime.resolveAsset('assets/icon.svg'), /已销毁/);
assert.equal(logs.some(entry => /Runtime 已清理/.test(entry.message)), true);

const previewProjectFile = fileURLToPath(new URL('../examples/project.json', import.meta.url));
const previewProjectRoot = path.dirname(previewProjectFile);
const previewAppSource = await fs.readFile(path.join(previewProjectRoot, '../preview/app.js'), 'utf8');
assert.match(previewAppSource, /expectedRevision:\s*target\.expectedRevision/, '面板 PATCH 必须提交乐观并发版本号');
assert.match(previewAppSource, /error\.status === 409/, '面板必须显式处理 Mock 版本冲突');
assert.match(previewAppSource, /refreshConflictRevision\(target\)/, '冲突后必须读取最新 Mock revision 并保留草稿');
assert.match(previewAppSource, /pendingSessionRevision = Math\.max\(pendingSessionRevision, requestedRevision\)/, '连续 SSE 必须记录最高待同步 revision');
const sessionUpdatedHandlerStart = previewAppSource.indexOf("eventSource.addEventListener('session-updated'");
assert.notEqual(sessionUpdatedHandlerStart, -1, '面板必须订阅 session-updated SSE');
assert.match(previewAppSource.slice(sessionUpdatedHandlerStart, sessionUpdatedHandlerStart + 260), /queueSessionRefresh\(payload\.revision\)/, 'session-updated 不能在刷新中直接丢弃后续 revision');
const previewProject = JSON.parse(await fs.readFile(previewProjectFile, 'utf8'));
const previewInputFiles = [
  previewProjectFile,
  path.join(previewProjectRoot, previewProject.tablesFile),
  ...Object.values(previewProject.files).map(source => path.join(previewProjectRoot, source)),
].sort();
const previewInputBefore = await Promise.all(previewInputFiles.map(file => fs.readFile(file)));
const previewServer = await startPreviewServer({
  projectFile: previewProjectFile,
  port: 0,
  watch: false,
});
try {
  assert.equal(previewServer.host, '127.0.0.1');
  assert.match(previewServer.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const indexResponse = await fetch(previewServer.url);
  assert.equal(indexResponse.status, 200);
  const indexHtml = await indexResponse.text();
  assert.match(indexHtml, /sandbox="allow-scripts"/);
  assert.doesNotMatch(indexHtml, /allow-same-origin/);

  const frameResponse = await fetch(new URL('frame.html', previewServer.url));
  assert.equal(frameResponse.status, 200);
  const frameCsp = frameResponse.headers.get('content-security-policy') || '';
  assert.match(frameCsp, /script-src http:\/\/127\.0\.0\.1:\* blob:/);
  assert.match(frameCsp, /connect-src 'none'/);
  assert.doesNotMatch(frameCsp, /unsafe-eval/);

  const runtimeResponse = await fetch(new URL('runtime-v1.js', previewServer.url));
  assert.equal(runtimeResponse.status, 200);
  assert.equal(runtimeResponse.headers.get('access-control-allow-origin'), '*');
  assert.match(runtimeResponse.headers.get('content-type') || '', /^text\/javascript/);

  const sessionResponse = await fetch(new URL('api/session', previewServer.url));
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.headers.get('access-control-allow-origin'), null);
  const initialSession = await sessionResponse.json();
  assert.equal(initialSession.simulationOnly, true);
  assert.equal(initialSession.mock.storage, 'process-memory');
  const initialMock = initialSession.mock.tables[0];
  assert.ok(initialMock, '示例预览会话必须包含可编辑 Mock 表');

  const changedRows = structuredClone(initialMock.rows);
  changedRows[0][0] = '玉子·制作期 Mock';
  const mockPath = 'api/mock/tables/' + encodeURIComponent(initialMock.sheetKey);
  const patchResponse = await fetch(new URL(mockPath, previewServer.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ headers: initialMock.headers, rows: changedRows, expectedRevision: initialMock.revision }),
  });
  assert.equal(patchResponse.status, 200);
  const patchResult = await patchResponse.json();
  assert.equal(patchResult.table.rows[0][0], '玉子·制作期 Mock');
  assert.equal(patchResult.table.dirty, true);

  const conflictResponse = await fetch(new URL(mockPath, previewServer.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ headers: initialMock.headers, rows: initialMock.rows, expectedRevision: initialMock.revision }),
  });
  assert.equal(conflictResponse.status, 409);

  const invalidResponse = await fetch(new URL(mockPath, previewServer.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ headers: '非法表头', rows: changedRows }),
  });
  assert.equal(invalidResponse.status, 400);

  const unknownResponse = await fetch(new URL('api/mock/tables/not-found', previewServer.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ headers: [], rows: [] }),
  });
  assert.equal(unknownResponse.status, 404);

  const resetResponse = await fetch(new URL(mockPath + '/reset', previewServer.url), {
    method: 'POST',
  });
  assert.equal(resetResponse.status, 200);
  assert.deepEqual((await resetResponse.json()).table.rows, initialMock.rows);

  const afterPatchSession = await (await fetch(new URL('api/session', previewServer.url))).json();
  assert.deepEqual(
    afterPatchSession.mock.tables.find(table => table.sheetKey === initialMock.sheetKey).rows,
    initialMock.rows,
    'reset 必须恢复真实基线，而不是写入项目文件',
  );
  const previewInputAfter = await Promise.all(previewInputFiles.map(file => fs.readFile(file)));
  assert.deepEqual(previewInputAfter, previewInputBefore, 'Mock HTTP API 不得写入项目、表格或页面源码');
} finally {
  await previewServer.close();
}

console.log('[preview-runtime-tests] 通过');
