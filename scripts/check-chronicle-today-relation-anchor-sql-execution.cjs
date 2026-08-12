const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation.js');
const SQL_BUILDER_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation-sql.js');

function success() {
    return { ok: true, code: 'ok', rows: [], columns: [], values: [], rowCount: 0 };
}

function failure(code, message = code) {
    return { ok: false, code, message, rows: [], columns: [], values: [], rowCount: 0 };
}

async function runResolver(resolveContext, responses) {
    const calls = [];
    const result = await resolveContext({
        queryTableRows: async (options) => {
            calls.push({ ...options, columns: [...(options.columns || [])] });
            const response = responses[options.tableName];
            return typeof response === 'function' ? response(options, calls) : response;
        },
    });
    return { result, calls };
}

function assertQueryCall(call, tableName, columns) {
    assert.deepStrictEqual(call, {
        tableName,
        columns,
        limit: 1,
    }, `${tableName} 必须通过 queryTableRows 按逻辑表名和集中列契约检查`);
}

async function main() {
    const sourceModule = await import(pathToFileURL(SOURCE_PATH).href);
    const sqlModule = await import(pathToFileURL(SQL_BUILDER_PATH).href);
    const resolveContext = sourceModule.resolveChronicleTodayRelationContext;

    assert.strictEqual(typeof resolveContext, 'function', '纪要派生器必须导出 context resolver');
    assert.deepStrictEqual(
        sqlModule.CHRONICLE_TODAY_RELATION_ANCHOR_TABLES,
        ['global_state', 'current_status'],
        '锚点优先级必须保持 global_state -> current_status',
    );

    const preferred = await runResolver(resolveContext, {
        chronicle: success(),
        global_state: success(),
        current_status: success(),
    });
    assert.deepStrictEqual(preferred.result, { status: 'ready', context: { anchorTable: 'global_state' } }, '两个锚点都可用时必须优先 global_state');
    assert.strictEqual(preferred.calls.length, 2, '命中 global_state 后不得继续探测 current_status');
    assertQueryCall(preferred.calls[0], 'chronicle', [...sqlModule.CHRONICLE_TODAY_RELATION_REQUIRED_COLUMNS]);
    assertQueryCall(preferred.calls[1], 'global_state', [...sqlModule.CHRONICLE_TODAY_RELATION_ANCHOR_REQUIRED_COLUMNS]);

    const fallback = await runResolver(resolveContext, {
        chronicle: success(),
        global_state: failure('column_not_resolved', 'global_state.cur_time missing'),
        current_status: success(),
    });
    assert.deepStrictEqual(fallback.result, { status: 'ready', context: { anchorTable: 'current_status' } }, 'global_state 结构不完整时必须回退 current_status');
    assert.deepStrictEqual(fallback.calls.map(call => call.tableName), ['chronicle', 'global_state', 'current_status'], '锚点探测顺序必须稳定');
    assertQueryCall(fallback.calls[2], 'current_status', [...sqlModule.CHRONICLE_TODAY_RELATION_ANCHOR_REQUIRED_COLUMNS]);

    const blocked = await runResolver(resolveContext, {
        chronicle: success(),
        global_state: failure('table_not_found', 'global_state missing'),
        current_status: failure('alias_conflict', 'current_status ambiguous'),
    });
    assert.strictEqual(blocked.result.status, 'completed', '两个锚点都结构不可用时必须安全跳过');
    assert.strictEqual(blocked.result.warning?.action, 'chronicle-today-relation.schema-blocked', '结构阻断必须给出稳定 warning action');
    assert.deepStrictEqual(blocked.result.warning?.context?.failures?.map(item => item.tableName), ['global_state', 'current_status'], '结构 warning 必须保留全部锚点失败顺序');

    const chronicleMissing = await runResolver(resolveContext, {
        chronicle: failure('table_not_found', 'chronicle missing'),
    });
    assert.strictEqual(chronicleMissing.result.status, 'completed', 'chronicle 逻辑表缺失时必须安全跳过');
    assert.deepStrictEqual(chronicleMissing.calls.map(call => call.tableName), ['chronicle'], 'chronicle 结构不满足时不得继续检查锚点');

    const runtimeNotReady = await runResolver(resolveContext, {
        chronicle: failure('runtime_not_ready', 'runtime warming'),
    });
    assert.deepStrictEqual(runtimeNotReady.result, { status: 'runtime-not-ready' }, 'runtime 暂不可用必须交给共享服务做有界等待');

    const transientFailure = failure('query_failed', 'temporary read failure');
    const queryFailed = await runResolver(resolveContext, {
        chronicle: success(),
        global_state: transientFailure,
    });
    assert.strictEqual(queryFailed.result.status, 'query-failed', '非结构读取失败必须进入查询重试语义');
    assert.strictEqual(queryFailed.result.result, transientFailure, '查询失败必须保留 repository 归一化结果');

    console.log('[通过] 纪要 today_relation context resolver 执行合同：逻辑表列检查、空表成功、锚点优先/回退、结构阻断与暂时失败分流通过');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
