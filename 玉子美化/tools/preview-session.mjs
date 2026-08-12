import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);
const DEFAULT_DIRECTORY_RETRY_DELAYS_MS = Object.freeze([24, 96, 320]);
const DEFAULT_CLOSE_DRAIN_MS = 500;

function clone(value) {
  return structuredClone(value);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asString(value) {
  return String(value ?? '');
}

function createError(message, { code = 'PREVIEW_SESSION_ERROR', statusCode = 400 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeRows(rows, headerCount) {
  if (!Array.isArray(rows)) throw createError('Mock rows 必须是数组', { code: 'MOCK_ROWS_INVALID' });
  return rows.map((row, rowIndex) => {
    if (!Array.isArray(row)) {
      throw createError(`Mock rows[${rowIndex}] 必须是数组`, { code: 'MOCK_ROW_INVALID' });
    }
    return Array.from({ length: headerCount }, (_value, columnIndex) => (
      columnIndex < row.length ? clone(row[columnIndex]) : ''
    ));
  });
}

function normalizeMockUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError('Mock 更新内容必须是对象', { code: 'MOCK_PAYLOAD_INVALID' });
  }
  if (!Array.isArray(input.headers)) throw createError('Mock headers 必须是数组', { code: 'MOCK_HEADERS_INVALID' });
  const headers = input.headers.map(asString);
  return { headers, rows: normalizeRows(input.rows, headers.length) };
}

function baselineForTable(table) {
  if (!table || typeof table !== 'object') throw createError('预览表数据无效', { code: 'PREVIEW_TABLE_INVALID', statusCode: 422 });
  if (!String(table.sheetKey || '').trim()) throw createError('预览表缺少 sheetKey', { code: 'PREVIEW_TABLE_KEY_INVALID', statusCode: 422 });
  if (!Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    throw createError(`预览表 ${table.sheetKey} 缺少 headers 或 rows`, { code: 'PREVIEW_TABLE_SHAPE_INVALID', statusCode: 422 });
  }
  return {
    sheetKey: String(table.sheetKey),
    tableName: asString(table.tableName),
    headers: table.headers.map(asString),
    rows: clone(table.rows),
  };
}

function mockSnapshot(record) {
  return {
    sheetKey: record.sheetKey,
    tableName: record.tableName,
    headers: clone(record.headers),
    rows: clone(record.rows),
    revision: record.revision,
    dirty: record.dirty,
    schemaDiverged: record.schemaDiverged,
  };
}

function serializeError(error, reason) {
  return {
    code: error?.code || 'PREVIEW_BUILD_ERROR',
    message: error?.message || String(error),
    reason,
    at: new Date().toISOString(),
  };
}

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORY_NAMES.has(name);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function waitForSettled(promise, timeoutMs) {
  if (timeoutMs === 0) return Promise.resolve();
  return new Promise(resolve => {
    let timer = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    Promise.resolve(promise).then(finish, finish);
  });
}

/**
 * 预览专用内存表库。它不会持有或写入项目文件。
 */
export class PreviewMockDatabase {
  #records = new Map();
  #revision = 0;

  constructor(tables = []) {
    this.reconcile(tables);
  }

  get revision() {
    return this.#revision;
  }

  snapshots() {
    return [...this.#records.values()].map(mockSnapshot);
  }

  snapshot(sheetKey) {
    const record = this.#records.get(String(sheetKey));
    if (!record) throw createError(`Mock 表不存在：${sheetKey}`, { code: 'MOCK_TABLE_NOT_FOUND', statusCode: 404 });
    return mockSnapshot(record);
  }

  update(sheetKey, input, { expectedRevision = null } = {}) {
    const record = this.#records.get(String(sheetKey));
    if (!record) throw createError(`Mock 表不存在：${sheetKey}`, { code: 'MOCK_TABLE_NOT_FOUND', statusCode: 404 });
    if (expectedRevision !== null && expectedRevision !== undefined) {
      const expected = Number(expectedRevision);
      if (!Number.isInteger(expected) || expected !== record.revision) {
        throw createError(`Mock 表版本冲突：${sheetKey}`, {
          code: 'MOCK_REVISION_CONFLICT',
          statusCode: 409,
        });
      }
    }
    const next = normalizeMockUpdate(input);
    if (equal(record.headers, next.headers) && equal(record.rows, next.rows)) return mockSnapshot(record);
    record.headers = next.headers;
    record.rows = next.rows;
    record.revision += 1;
    record.dirty = !equal({ headers: record.headers, rows: record.rows }, {
      headers: record.baseline.headers,
      rows: record.baseline.rows,
    });
    if (!record.dirty) record.schemaDiverged = false;
    this.#revision += 1;
    return mockSnapshot(record);
  }

  reset(sheetKey) {
    const record = this.#records.get(String(sheetKey));
    if (!record) throw createError(`Mock 表不存在：${sheetKey}`, { code: 'MOCK_TABLE_NOT_FOUND', statusCode: 404 });
    const nextHeaders = clone(record.baseline.headers);
    const nextRows = clone(record.baseline.rows);
    if (equal(record.headers, nextHeaders) && equal(record.rows, nextRows) && !record.schemaDiverged) return mockSnapshot(record);
    record.headers = nextHeaders;
    record.rows = nextRows;
    record.revision += 1;
    record.dirty = false;
    record.schemaDiverged = false;
    this.#revision += 1;
    return mockSnapshot(record);
  }

  reconcile(tables) {
    if (!Array.isArray(tables)) throw createError('预览会话 tables 必须是数组', { code: 'PREVIEW_TABLES_INVALID', statusCode: 422 });
    const nextBaselines = tables.map(baselineForTable);
    const nextKeys = new Set(nextBaselines.map(table => table.sheetKey));
    let changed = false;
    for (const baseline of nextBaselines) {
      const existing = this.#records.get(baseline.sheetKey);
      if (!existing) {
        this.#records.set(baseline.sheetKey, {
          ...clone(baseline),
          baseline: clone(baseline),
          revision: 1,
          dirty: false,
          schemaDiverged: false,
        });
        changed = true;
        continue;
      }
      const baselineChanged = !equal(existing.baseline, baseline);
      const schemaChanged = existing.baseline.tableName !== baseline.tableName
        || !equal(existing.baseline.headers, baseline.headers);
      const wasDirty = existing.dirty;
      existing.tableName = baseline.tableName;
      existing.baseline = clone(baseline);
      if (!wasDirty) {
        existing.headers = clone(baseline.headers);
        existing.rows = clone(baseline.rows);
        existing.schemaDiverged = false;
      } else if (schemaChanged) {
        existing.schemaDiverged = true;
      }
      existing.dirty = !equal({ headers: existing.headers, rows: existing.rows }, {
        headers: existing.baseline.headers,
        rows: existing.baseline.rows,
      });
      if (!existing.dirty) existing.schemaDiverged = false;
      if (baselineChanged) {
        existing.revision += 1;
        changed = true;
      }
    }
    for (const sheetKey of this.#records.keys()) {
      if (!nextKeys.has(sheetKey)) {
        this.#records.delete(sheetKey);
        changed = true;
      }
    }
    if (changed) this.#revision += 1;
    return this.snapshots();
  }
}

/**
 * 在项目目录树内监听源码变化。监听本身不写入任何文件。
 */
export async function watchProjectTree(root, {
  onChange = () => {},
  onError = () => {},
  retryDelaysMs = DEFAULT_DIRECTORY_RETRY_DELAYS_MS,
  fsModule = fs,
  fsPromisesModule = fsPromises,
} = {}) {
  if (!Array.isArray(retryDelaysMs) || retryDelaysMs.some(delay => !Number.isInteger(delay) || delay < 0)) {
    throw createError('retryDelaysMs 必须是非负整数数组', { code: 'PREVIEW_WATCH_RETRY_DELAYS_INVALID', statusCode: 422 });
  }
  const rootPath = await fsPromisesModule.realpath(root);
  const watchers = new Map();
  const retryTimers = new Map();
  const scanTasks = new Map();
  let closed = false;

  const isIgnored = candidate => {
    if (!isPathInside(rootPath, candidate)) return true;
    const relative = path.relative(rootPath, candidate);
    return relative.split(path.sep).filter(Boolean).some(isIgnoredDirectory);
  };

  const cancelRetry = directory => {
    const timer = retryTimers.get(directory);
    if (timer) clearTimeout(timer);
    retryTimers.delete(directory);
  };

  const scheduleDirectoryRetry = (directory, retryIndex) => {
    if (closed || isIgnored(directory) || retryIndex >= retryDelaysMs.length || retryTimers.has(directory)) return;
    const timer = setTimeout(() => {
      retryTimers.delete(directory);
      if (!closed) void addDirectory(directory, retryIndex + 1);
    }, retryDelaysMs[retryIndex]);
    timer.unref?.();
    retryTimers.set(directory, timer);
  };

  const addDirectory = async (candidate, retryIndex = 0) => {
    const directory = path.resolve(candidate);
    if (closed || isIgnored(directory)) return;
    let stat;
    try {
      stat = await fsPromisesModule.stat(directory);
    } catch {
      if (!closed) scheduleDirectoryRetry(directory, retryIndex);
      return;
    }
    if (closed || !stat.isDirectory()) return;
    cancelRetry(directory);
    let watcher = watchers.get(directory);
    if (!watcher) {
      try {
        watcher = fsModule.watch(directory, { persistent: false }, (eventType, filename) => {
          const changedPath = filename ? path.resolve(directory, String(filename)) : directory;
          if (closed || isIgnored(changedPath)) return;
          onChange({ eventType, path: changedPath });
          if (eventType === 'rename') void addDirectory(changedPath);
        });
        watcher.on?.('error', error => {
          if (!closed) onError(error);
        });
      } catch (error) {
        if (!closed) {
          onError(error);
          scheduleDirectoryRetry(directory, retryIndex);
        }
        return;
      }
      if (closed) {
        watcher.close?.();
        return;
      }
      watchers.set(directory, watcher);
    }
    if (closed) {
      if (watchers.get(directory) === watcher) watchers.delete(directory);
      watcher.close?.();
      return;
    }
    const activeScan = scanTasks.get(directory);
    if (activeScan) return activeScan;
    const scanTask = (async () => {
      let entries;
      try {
        entries = await fsPromisesModule.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (!closed) {
          onError(error);
          scheduleDirectoryRetry(directory, retryIndex);
        }
        return;
      }
      if (closed) return;
      await Promise.all(entries
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !isIgnoredDirectory(entry.name))
        .map(entry => addDirectory(path.join(directory, entry.name))));
    })();
    scanTasks.set(directory, scanTask);
    try {
      await scanTask;
    } finally {
      if (scanTasks.get(directory) === scanTask) scanTasks.delete(directory);
    }
  };

  await addDirectory(rootPath);
  return Object.freeze({
    close() {
      if (closed) return;
      closed = true;
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    get watchedDirectoryCount() {
      return watchers.size;
    },
  });
}

/**
 * 预览期状态控制器：真实 Bundle 只读，Mock 表只驻留进程内存。
 */
export async function createPreviewSessionController({
  projectFile,
  buildSession,
  watch = true,
  watchDebounceMs = 160,
  closeDrainMs = DEFAULT_CLOSE_DRAIN_MS,
  watchFactory = watchProjectTree,
} = {}) {
  if (typeof buildSession !== 'function') throw createError('buildSession 必须是函数', { code: 'PREVIEW_BUILD_FUNCTION_INVALID', statusCode: 422 });
  if (!Number.isInteger(watchDebounceMs) || watchDebounceMs < 0) {
    throw createError('watchDebounceMs 必须是非负整数', { code: 'PREVIEW_WATCH_DELAY_INVALID', statusCode: 422 });
  }
  if (!Number.isInteger(closeDrainMs) || closeDrainMs < 0) {
    throw createError('closeDrainMs 必须是非负整数', { code: 'PREVIEW_CLOSE_DRAIN_INVALID', statusCode: 422 });
  }
  let currentSession = await buildSession();
  if (!currentSession || !Array.isArray(currentSession.tables) || !currentSession.projectFile) {
    throw createError('buildSession 没有返回完整预览会话', { code: 'PREVIEW_SESSION_INVALID', statusCode: 422 });
  }
  const mockDatabase = new PreviewMockDatabase(currentSession.tables);
  const listeners = new Set();
  let watcher = null;
  let closed = false;
  let sessionRevision = 1;
  let lastSuccessAt = new Date().toISOString();
  let lastError = null;
  let buildStatus = 'ready';
  let rebuildChain = Promise.resolve();
  let debounceTimer = null;

  const snapshot = () => clone({
    ...currentSession,
    revision: sessionRevision,
    mock: {
      storage: 'process-memory',
      revision: mockDatabase.revision,
      tables: mockDatabase.snapshots(),
    },
    build: {
      status: buildStatus,
      lastSuccessAt,
      lastError: clone(lastError),
      watching: Boolean(watcher),
    },
  });

  const publish = (type, detail = {}) => {
    const event = Object.freeze({ type, detail: clone(detail), session: snapshot() });
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // 预览订阅者错误不应影响其他订阅者或当前会话。
      }
    }
  };

  const rebuild = async ({ reason = 'manual', throwOnError = true } = {}) => {
    const execute = async () => {
      const closedResult = () => {
        const error = createError('预览会话已关闭', { code: 'PREVIEW_SESSION_CLOSED', statusCode: 410 });
        if (throwOnError) throw error;
        return snapshot();
      };
      if (closed) return closedResult();
      buildStatus = 'building';
      publish('build-started', { reason });
      try {
        const nextSession = await buildSession();
        if (closed) return closedResult();
        if (!nextSession || !Array.isArray(nextSession.tables) || !nextSession.projectFile) {
          throw createError('重构建没有返回完整预览会话', { code: 'PREVIEW_SESSION_INVALID', statusCode: 422 });
        }
        currentSession = nextSession;
        mockDatabase.reconcile(nextSession.tables);
        sessionRevision += 1;
        lastSuccessAt = new Date().toISOString();
        lastError = null;
        buildStatus = 'ready';
        publish('session-updated', { reason, revision: sessionRevision });
        return snapshot();
      } catch (error) {
        if (closed) return closedResult();
        buildStatus = 'error';
        lastError = serializeError(error, reason);
        publish('build-error', { ...lastError, revision: sessionRevision });
        if (throwOnError) throw error;
        return snapshot();
      }
    };
    const task = rebuildChain.catch(() => undefined).then(execute);
    rebuildChain = task.catch(() => undefined);
    return task;
  };

  const scheduleRebuild = (reason = 'source-watch') => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void rebuild({ reason, throwOnError: false });
    }, watchDebounceMs);
  };

  if (watch) {
    const requestedProjectPath = projectFile ? path.resolve(String(projectFile)) : currentSession.projectFile;
    watcher = await watchFactory(path.dirname(requestedProjectPath), {
      onChange() {
        scheduleRebuild('source-watch');
      },
      onError(error) {
        if (!closed) publish('watch-error', serializeError(error, 'source-watch'));
      },
    });
  }

  return Object.freeze({
    getSession: snapshot,
    getStatus() {
      return snapshot().build;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw createError('预览订阅 listener 必须是函数', { code: 'PREVIEW_LISTENER_INVALID' });
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateMockTable(sheetKey, input, options = {}) {
      if (closed) throw createError('预览会话已关闭', { code: 'PREVIEW_SESSION_CLOSED', statusCode: 410 });
      const table = mockDatabase.update(sheetKey, input, options);
      publish('mock-updated', { sheetKey: table.sheetKey, revision: table.revision });
      return { table, session: snapshot() };
    },
    resetMockTable(sheetKey) {
      if (closed) throw createError('预览会话已关闭', { code: 'PREVIEW_SESSION_CLOSED', statusCode: 410 });
      const table = mockDatabase.reset(sheetKey);
      publish('mock-reset', { sheetKey: table.sheetKey, revision: table.revision });
      return { table, session: snapshot() };
    },
    rebuild,
    scheduleRebuild,
    async flush() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        await rebuild({ reason: 'flush', throwOnError: false });
      }
      await rebuildChain;
      return snapshot();
    },
    async close() {
      if (closed) return;
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      watcher?.close?.();
      watcher = null;
      listeners.clear();
      await waitForSettled(rebuildChain, closeDrainMs);
    },
    get closed() {
      return closed;
    },
    get watchedDirectoryCount() {
      return watcher?.watchedDirectoryCount || 0;
    },
  });
}
