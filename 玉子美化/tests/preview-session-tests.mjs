import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as waitImmediate, setTimeout as waitTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  createPreviewSessionController,
  PreviewMockDatabase,
  watchProjectTree,
} from '../tools/preview-session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workshopRoot = path.resolve(here, '..');
const tempTestsRoot = path.join(workshopRoot, '.tmp-tests');

function makeTable(overrides = {}) {
  return {
    sheetKey: 'sheet_profile',
    tableName: '角色表',
    headers: ['姓名', '状态'],
    rows: [['玉子', '平静']],
    ...structuredClone(overrides),
  };
}

function makeSession(projectFile, marker, table = makeTable()) {
  return {
    kind: 'yuzi-beautify-preview-session',
    projectFile,
    bundle: { marker },
    tables: [structuredClone(table)],
    selectedItemId: 'fixture-item',
    selectedSheetKey: table.sheetKey,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assertErrorCode(expectedCode) {
  return error => error?.code === expectedCode;
}

await fs.mkdir(tempTestsRoot, { recursive: true });
const tempRoot = await fs.mkdtemp(path.join(tempTestsRoot, 'preview-session-'));
const projectFile = path.join(tempRoot, 'project.json');
const projectFileContents = '{"fixture":"preview-session"}\n';
await fs.writeFile(projectFile, projectFileContents, 'utf8');

try {
  const sourceTable = makeTable({
    headers: ['姓名', '资料'],
    rows: [['玉子', { tags: ['初始'] }]],
  });
  const mockDatabase = new PreviewMockDatabase([sourceTable]);
  sourceTable.headers[0] = '外部改写';
  sourceTable.rows[0][0] = '外部改写';
  sourceTable.rows[0][1].tags.push('外部改写');
  assert.deepEqual(mockDatabase.snapshot('sheet_profile'), {
    sheetKey: 'sheet_profile',
    tableName: '角色表',
    headers: ['姓名', '资料'],
    rows: [['玉子', { tags: ['初始'] }]],
    revision: 1,
    dirty: false,
    schemaDiverged: false,
  }, '构造输入不得反向修改内存基线');

  const returnedSnapshot = mockDatabase.snapshot('sheet_profile');
  returnedSnapshot.headers[0] = '返回值改写';
  returnedSnapshot.rows[0][0] = '返回值改写';
  returnedSnapshot.rows[0][1].tags.push('返回值改写');
  const returnedSnapshots = mockDatabase.snapshots();
  returnedSnapshots[0].rows[0][1].tags.push('批量返回值改写');
  assert.deepEqual(mockDatabase.snapshot('sheet_profile').rows, [['玉子', { tags: ['初始'] }]], '返回快照必须深拷贝');

  const updatePayload = {
    headers: ['姓名', '资料'],
    rows: [['玉子·Mock', { tags: ['制作中'] }]],
  };
  mockDatabase.update('sheet_profile', updatePayload);
  updatePayload.headers[0] = '更新输入改写';
  updatePayload.rows[0][0] = '更新输入改写';
  updatePayload.rows[0][1].tags.push('更新输入改写');
  assert.deepEqual(mockDatabase.snapshot('sheet_profile').rows, [['玉子·Mock', { tags: ['制作中'] }]], '更新输入必须在写入前深拷贝');

  const stateBeforeInvalidUpdates = mockDatabase.snapshot('sheet_profile');
  const invalidUpdates = [
    {
      code: 'MOCK_TABLE_NOT_FOUND',
      run: () => mockDatabase.update('missing-sheet', { headers: [], rows: [] }),
    },
    {
      code: 'MOCK_HEADERS_INVALID',
      run: () => mockDatabase.update('sheet_profile', { headers: '不是数组', rows: [] }),
    },
    {
      code: 'MOCK_ROWS_INVALID',
      run: () => mockDatabase.update('sheet_profile', { headers: [], rows: {} }),
    },
    {
      code: 'MOCK_ROW_INVALID',
      run: () => mockDatabase.update('sheet_profile', { headers: ['姓名'], rows: [{ value: '不是数组行' }] }),
    },
  ];
  for (const invalidUpdate of invalidUpdates) {
    assert.throws(invalidUpdate.run, assertErrorCode(invalidUpdate.code));
    assert.deepEqual(
      mockDatabase.snapshot('sheet_profile'),
      stateBeforeInvalidUpdates,
      `拒绝 ${invalidUpdate.code} 后不得污染既有 Mock 状态`,
    );
  }

  const resetResult = mockDatabase.reset('sheet_profile');
  assert.equal(resetResult.dirty, false);
  assert.deepEqual(resetResult.headers, ['姓名', '资料']);
  assert.deepEqual(resetResult.rows, [['玉子', { tags: ['初始'] }]], 'reset 必须恢复当前真实基线');
  assert.throws(() => mockDatabase.reset('missing-sheet'), assertErrorCode('MOCK_TABLE_NOT_FOUND'));

  const rowsOnlyDatabase = new PreviewMockDatabase([makeTable()]);
  rowsOnlyDatabase.update('sheet_profile', { headers: ['姓名', '状态'], rows: [['玉子', 'Mock 编辑']] });
  rowsOnlyDatabase.reconcile([makeTable({ rows: [['玉子', '真实数据更新']] })]);
  const rowsOnlySnapshot = rowsOnlyDatabase.snapshot('sheet_profile');
  assert.equal(rowsOnlySnapshot.schemaDiverged, false, '真实 rows 变化不应视为表结构分叉');
  assert.deepEqual(rowsOnlySnapshot.rows, [['玉子', 'Mock 编辑']], '真实 rows 变化时必须保留已有 Mock 编辑');

  const headersDatabase = new PreviewMockDatabase([makeTable()]);
  headersDatabase.update('sheet_profile', { headers: ['姓名', '状态'], rows: [['玉子', 'Mock 编辑']] });
  headersDatabase.reconcile([makeTable({ headers: ['称呼', '状态'], rows: [['玉子', '真实数据更新']] })]);
  const headersSnapshot = headersDatabase.snapshot('sheet_profile');
  assert.equal(headersSnapshot.schemaDiverged, true, '真实 headers 变化必须标记表结构分叉');
  assert.deepEqual(headersSnapshot.rows, [['玉子', 'Mock 编辑']], '表头分叉时必须保留已有 Mock 编辑供用户决定重置');

  const tableNameDatabase = new PreviewMockDatabase([makeTable()]);
  tableNameDatabase.update('sheet_profile', { headers: ['姓名', '状态'], rows: [['玉子', 'Mock 编辑']] });
  tableNameDatabase.reconcile([makeTable({ tableName: '已改名角色表' })]);
  const tableNameSnapshot = tableNameDatabase.snapshot('sheet_profile');
  assert.equal(tableNameSnapshot.schemaDiverged, true, '真实 tableName 变化必须标记表结构分叉');
  assert.deepEqual(tableNameSnapshot.rows, [['玉子', 'Mock 编辑']]);

  let successfulBuilds = 0;
  const successfulController = await createPreviewSessionController({
    projectFile,
    watch: false,
    async buildSession() {
      successfulBuilds += 1;
      return makeSession(
        projectFile,
        successfulBuilds === 1 ? 'initial-success' : 'rebuilt-success',
        makeTable({ rows: [['玉子', successfulBuilds === 1 ? '真实初始' : '真实重建']] }),
      );
    },
  });
  const successfulEvents = [];
  const unsubscribeSuccessful = successfulController.subscribe(event => successfulEvents.push(event.type));
  successfulController.updateMockTable('sheet_profile', {
    headers: ['姓名', '状态'],
    rows: [['玉子', '保留的 Mock 编辑']],
  });
  const successfulRebuild = await successfulController.rebuild({ reason: 'test-success' });
  assert.equal(successfulBuilds, 2);
  assert.equal(successfulRebuild.revision, 2);
  assert.equal(successfulRebuild.bundle.marker, 'rebuilt-success');
  assert.equal(successfulRebuild.build.status, 'ready');
  assert.equal(successfulRebuild.build.lastError, null);
  assert.deepEqual(successfulRebuild.mock.tables[0].rows, [['玉子', '保留的 Mock 编辑']], '成功重建不得覆盖已编辑 Mock');
  assert.deepEqual(successfulEvents, ['mock-updated', 'build-started', 'session-updated']);
  unsubscribeSuccessful();
  await successfulController.close();

  let recoveryBuilds = 0;
  const recoveryFailure = Object.assign(new Error('fixture rebuild failure'), { code: 'FIXTURE_BUILD_FAILED' });
  const recoveryController = await createPreviewSessionController({
    projectFile,
    watch: false,
    async buildSession() {
      recoveryBuilds += 1;
      if (recoveryBuilds === 1) return makeSession(projectFile, 'before-failure');
      if (recoveryBuilds === 2) throw recoveryFailure;
      return makeSession(projectFile, 'after-recovery', makeTable({ rows: [['玉子', '真实恢复']] }));
    },
  });
  recoveryController.updateMockTable('sheet_profile', {
    headers: ['姓名', '状态'],
    rows: [['玉子', '失败后仍应保留的 Mock']],
  });
  await assert.rejects(
    () => recoveryController.rebuild({ reason: 'intentional-failure' }),
    assertErrorCode('FIXTURE_BUILD_FAILED'),
  );
  const afterFailedRebuild = recoveryController.getSession();
  assert.equal(afterFailedRebuild.revision, 1, '失败重建不得递增 session revision');
  assert.equal(afterFailedRebuild.bundle.marker, 'before-failure', '失败重建不得替换上次成功 session');
  assert.equal(afterFailedRebuild.build.status, 'error');
  assert.equal(afterFailedRebuild.build.lastError.code, 'FIXTURE_BUILD_FAILED');
  assert.deepEqual(afterFailedRebuild.mock.tables[0].rows, [['玉子', '失败后仍应保留的 Mock']]);
  const recoveredSession = await recoveryController.rebuild({ reason: 'recovery' });
  assert.equal(recoveredSession.revision, 2);
  assert.equal(recoveredSession.bundle.marker, 'after-recovery');
  assert.equal(recoveredSession.build.status, 'ready');
  assert.equal(recoveredSession.build.lastError, null, '下一次成功重建必须清除上次错误');
  assert.deepEqual(recoveredSession.mock.tables[0].rows, [['玉子', '失败后仍应保留的 Mock']]);
  await recoveryController.close();

  const lateBuild = deferred();
  let lateBuildCalls = 0;
  const lateController = await createPreviewSessionController({
    projectFile,
    watch: false,
    buildSession() {
      lateBuildCalls += 1;
      if (lateBuildCalls === 1) return Promise.resolve(makeSession(projectFile, 'before-close'));
      return lateBuild.promise;
    },
  });
  const lateEvents = [];
  lateController.subscribe(event => lateEvents.push(event.type));
  const lateRebuild = lateController.rebuild({ reason: 'late-build' });
  await waitImmediate();
  assert.equal(lateBuildCalls, 2, '测试必须等到迟到 build 已实际启动');
  lateEvents.length = 0;
  const closeLateController = lateController.close();
  lateBuild.resolve(makeSession(projectFile, 'late-session'));
  await closeLateController;
  await assert.rejects(lateRebuild, assertErrorCode('PREVIEW_SESSION_CLOSED'));
  assert.equal(lateController.closed, true);
  assert.equal(lateController.getSession().revision, 1, '迟到 build 不得提交新 session');
  assert.equal(lateController.getSession().bundle.marker, 'before-close');
  assert.deepEqual(lateEvents, [], '关闭后的迟到 build 不得发布订阅事件');

  let watcherBuilds = 0;
  let watcherCallbacks;
  let watcherCloseCalls = 0;
  const watcherController = await createPreviewSessionController({
    projectFile,
    watch: true,
    watchDebounceMs: 0,
    async buildSession() {
      watcherBuilds += 1;
      return makeSession(projectFile, `watch-build-${watcherBuilds}`);
    },
    async watchFactory(_root, callbacks) {
      watcherCallbacks = callbacks;
      return {
        close() {
          watcherCloseCalls += 1;
        },
        get watchedDirectoryCount() {
          return 3;
        },
      };
    },
  });
  const watcherEvents = [];
  watcherController.subscribe(event => watcherEvents.push(event.type));
  assert.equal(watcherController.watchedDirectoryCount, 3);
  await watcherController.close();
  assert.equal(watcherCloseCalls, 1, 'controller.close 必须关闭 watcher');
  watcherCallbacks.onChange({ eventType: 'change', path: projectFile });
  await waitImmediate();
  await waitImmediate();
  assert.equal(watcherBuilds, 1, '关闭后触发旧 watcher 回调不得再次构建');
  assert.deepEqual(watcherEvents, [], '关闭后触发旧 watcher 回调不得发布事件');

  const delayedBuild = deferred();
  let delayedBuildCalls = 0;
  const boundedCloseController = await createPreviewSessionController({
    projectFile,
    watch: false,
    closeDrainMs: 8,
    buildSession() {
      delayedBuildCalls += 1;
      if (delayedBuildCalls === 1) return Promise.resolve(makeSession(projectFile, 'bounded-close-initial'));
      return delayedBuild.promise;
    },
  });
  const boundedCloseEvents = [];
  boundedCloseController.subscribe(event => boundedCloseEvents.push(event.type));
  const delayedRebuild = boundedCloseController.rebuild({ reason: 'bounded-close' });
  await waitImmediate();
  const boundedClose = boundedCloseController.close();
  assert.equal(
    await Promise.race([boundedClose.then(() => true), waitTimeout(120).then(() => false)]),
    true,
    '永不解决的构建不得无限阻塞 controller.close',
  );
  assert.equal(boundedCloseController.closed, true);
  delayedBuild.resolve(makeSession(projectFile, 'bounded-close-late'));
  await assert.rejects(delayedRebuild, assertErrorCode('PREVIEW_SESSION_CLOSED'));
  assert.deepEqual(boundedCloseEvents, ['build-started'], '关闭超时后迟到构建不得发布新事件');

  const directoryEntry = name => ({
    name,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  });
  const delayedWatchRoot = path.join(tempRoot, 'watch-close-race');
  const delayedWatchChild = path.join(delayedWatchRoot, 'late-directory');
  const childStat = deferred();
  const delayedWatchPaths = [];
  const delayedWatchClosePaths = [];
  let delayedRootCallback;
  const delayedTree = await watchProjectTree(delayedWatchRoot, {
    retryDelaysMs: [1],
    fsModule: {
      watch(directory, _options, callback) {
        delayedWatchPaths.push(directory);
        if (directory === delayedWatchRoot) delayedRootCallback = callback;
        return {
          on() {},
          close() { delayedWatchClosePaths.push(directory); },
        };
      },
    },
    fsPromisesModule: {
      async realpath(directory) { return directory; },
      async stat(directory) {
        if (directory === delayedWatchRoot) return { isDirectory: () => true };
        if (directory === delayedWatchChild) return childStat.promise;
        throw new Error(`unexpected stat: ${directory}`);
      },
      async readdir(directory) {
        assert.equal(directory, delayedWatchRoot);
        return [];
      },
    },
  });
  delayedRootCallback('rename', path.basename(delayedWatchChild));
  await waitImmediate();
  delayedTree.close();
  childStat.resolve({ isDirectory: () => true });
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(delayedWatchPaths, [delayedWatchRoot], '关闭期间完成的 stat 不得创建迟到 watcher');
  assert.deepEqual(delayedWatchClosePaths, [delayedWatchRoot], '关闭只应关闭已登记的 watcher');

  const retryWatchRoot = path.join(tempRoot, 'watch-retry');
  const retryWatchChild = path.join(retryWatchRoot, 'new-directory');
  const retryWatchPaths = [];
  let retryRootCallback;
  let retryChildStatCalls = 0;
  const retryTree = await watchProjectTree(retryWatchRoot, {
    retryDelaysMs: [2, 4],
    fsModule: {
      watch(directory, _options, callback) {
        retryWatchPaths.push(directory);
        if (directory === retryWatchRoot) retryRootCallback = callback;
        return { on() {}, close() {} };
      },
    },
    fsPromisesModule: {
      async realpath(directory) { return directory; },
      async stat(directory) {
        if (directory === retryWatchRoot) return { isDirectory: () => true };
        if (directory === retryWatchChild) {
          retryChildStatCalls += 1;
          if (retryChildStatCalls === 1) throw new Error('directory is not visible yet');
          return { isDirectory: () => true };
        }
        throw new Error(`unexpected stat: ${directory}`);
      },
      async readdir(directory) {
        if (directory === retryWatchRoot || directory === retryWatchChild) return [];
        return [directoryEntry(path.basename(directory))];
      },
    },
  });
  retryRootCallback('rename', path.basename(retryWatchChild));
  await waitTimeout(30);
  assert.equal(retryChildStatCalls, 2, '新增目录暂时不可见时必须有限重试');
  assert.deepEqual(retryWatchPaths, [retryWatchRoot, retryWatchChild], '重试成功后必须监听新目录');
  retryTree.close();

  const cancelledWatchRoot = path.join(tempRoot, 'watch-retry-cancel');
  const cancelledWatchChild = path.join(cancelledWatchRoot, 'removed-directory');
  let cancelledRootCallback;
  let cancelledChildStatCalls = 0;
  const cancelledTree = await watchProjectTree(cancelledWatchRoot, {
    retryDelaysMs: [30],
    fsModule: {
      watch(directory, _options, callback) {
        if (directory === cancelledWatchRoot) cancelledRootCallback = callback;
        return { on() {}, close() {} };
      },
    },
    fsPromisesModule: {
      async realpath(directory) { return directory; },
      async stat(directory) {
        if (directory === cancelledWatchRoot) return { isDirectory: () => true };
        if (directory === cancelledWatchChild) {
          cancelledChildStatCalls += 1;
          throw new Error('directory was removed');
        }
        throw new Error(`unexpected stat: ${directory}`);
      },
      async readdir() { return []; },
    },
  });
  cancelledRootCallback('rename', path.basename(cancelledWatchChild));
  await waitImmediate();
  cancelledTree.close();
  await waitTimeout(50);
  assert.equal(cancelledChildStatCalls, 1, '关闭时必须取消尚未执行的目录 retry');

  assert.equal(await fs.readFile(projectFile, 'utf8'), projectFileContents, 'session 测试不得写入 project.json 占位文件');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('[preview-session-tests] 通过');
