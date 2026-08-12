const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const originalWindow = global.window;

function publishApi(api) {
    global.window = {
        parent: { AutoCardUpdaterAPI: api },
        AutoCardUpdaterAPI: null,
    };
}

async function testMissingReadMethods(mod) {
    let diagnosticReads = 0;
    publishApi({
        getLastSqlApiError() {
            diagnosticReads += 1;
            return { method: 'querySql', code: 'stale_error', message: '不应读取', at: Date.now() };
        },
    });

    const sqlResult = await mod.querySqlViaApi('SELECT row_id FROM global_state');
    const tableResult = await mod.queryTableRowsViaApi({ tableName: 'global_state' });

    assert.strictEqual(sqlResult.ok, false);
    assert.strictEqual(sqlResult.code, 'runtime_not_ready');
    assert.strictEqual(tableResult.ok, false);
    assert.strictEqual(tableResult.code, 'runtime_not_ready');
    assert.strictEqual(diagnosticReads, 0, 'runtime 未发布时不得读取 sticky SQL 诊断');
}

async function testQueryTableRowsPassThrough(mod) {
    const options = {
        tableName: 'global_state',
        columns: ['row_id', 'cur_time'],
        where: { row_id: { operator: '>=', value: 1 } },
        orderBy: [{ column: 'row_id', direction: 'asc' }],
        limit: 20,
        offset: 0,
    };
    const rawResult = {
        rows: [{ row_id: 1, cur_time: '2026-08-09' }],
        columns: ['row_id', 'cur_time'],
        values: [[1, '2026-08-09']],
        errors: [],
        saved: true,
        success: true,
    };
    let receivedOptions = null;
    let boundThis = null;
    const api = {
        queryTableRows(received) {
            receivedOptions = received;
            boundThis = this;
            return rawResult;
        },
    };
    publishApi(api);

    const result = await mod.queryTableRowsViaApi(options);

    assert.strictEqual(boundThis, api, 'queryTableRows 必须绑定到底层 API 对象');
    assert.deepStrictEqual(receivedOptions, options, '声明式查询 options 的深层内容必须原样透传');
    assert.notStrictEqual(receivedOptions, options, 'repository 应只创建顶层 options 副本');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'ok');
    assert.strictEqual(result.result, rawResult);
    assert.deepStrictEqual(result.rows, rawResult.rows);
    assert.deepStrictEqual(result.columns, rawResult.columns);
    assert.deepStrictEqual(result.values, rawResult.values);
    assert.strictEqual(result.rowCount, 1);
}

async function testFreshDiagnostic(mod) {
    let calledAt = 0;
    let diagnosticReads = 0;
    const api = {
        querySql() {
            calledAt = Date.now();
            return null;
        },
        getLastSqlApiError() {
            diagnosticReads += 1;
            return {
                method: 'querySql',
                code: 'alias_conflict',
                message: '表别名存在冲突',
                at: calledAt,
            };
        },
    };
    publishApi(api);

    const result = await mod.querySqlViaApi('SELECT row_id FROM global_state');

    assert.strictEqual(diagnosticReads, 1);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'alias_conflict');
    assert.strictEqual(result.message, '表别名存在冲突');
    assert.deepStrictEqual(result.sqlApiError, {
        method: 'querySql',
        code: 'alias_conflict',
        message: '表别名存在冲突',
        at: calledAt,
    });
}

async function testStickyOldDiagnostic(mod) {
    publishApi({
        queryTableRows() {
            return null;
        },
        getLastSqlApiError() {
            return {
                method: 'queryTableRows',
                code: 'old_error',
                message: '上一次查询留下的错误',
                at: 1,
            };
        },
    });

    const result = await mod.queryTableRowsViaApi({ tableName: 'global_state' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'query_failed');
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'sqlApiError'), '旧诊断不得附着到本次查询');
}

async function testWrongMethodDiagnostic(mod) {
    let calledAt = 0;
    publishApi({
        querySql() {
            calledAt = Date.now();
            return null;
        },
        getLastSqlApiError() {
            return {
                method: 'queryTableRows',
                code: 'wrong_method',
                message: '其他查询留下的错误',
                at: calledAt,
            };
        },
    });

    const result = await mod.querySqlViaApi('SELECT cur_time FROM global_state');

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'query_failed');
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'sqlApiError'), '错 method 诊断不得附着到本次查询');
}

async function main() {
    const repositoryUrl = pathToFileURL(path.join(
        ROOT,
        'modules',
        'phone-core',
        'data-api',
        'sql-repository.js',
    ));
    const mod = await import(`${repositoryUrl.href}?read-behavior=${Date.now()}`);

    await testMissingReadMethods(mod);
    await testQueryTableRowsPassThrough(mod);
    await testFreshDiagnostic(mod);
    await testStickyOldDiagnostic(mod);
    await testWrongMethodDiagnostic(mod);

    console.log('[通过] SQL repository 只读行为：runtime 就绪信号、声明式查询透传与 sticky 诊断隔离通过');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        if (originalWindow === undefined) {
            delete global.window;
        } else {
            global.window = originalWindow;
        }
    });
