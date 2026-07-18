const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY_PATH = path.join(ROOT, 'modules', 'phone-core', 'data-api', 'sql-repository.js');
const MUTATION_SETTLEMENT_PATH = path.join(ROOT, 'modules', 'phone-core', 'data-api', 'mutation-settlement.js');
const DATA_API_PATH = path.join(ROOT, 'modules', 'phone-core', 'data-api.js');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(source, needle, message) {
    assert.ok(source.includes(needle), message);
}

function assertNotIncludes(source, needle, message) {
    assert.ok(!source.includes(needle), message);
}

function main() {
    const repository = read(REPOSITORY_PATH);
    const mutationSettlement = read(MUTATION_SETTLEMENT_PATH);
    const dataApi = read(DATA_API_PATH);

    assertIncludes(dataApi, "from './data-api/sql-repository.js';", 'data-api facade 必须导出 SQL repository');
    assertIncludes(dataApi, 'querySqlViaApi', 'data-api facade 必须导出 querySqlViaApi');
    assertIncludes(dataApi, 'executeSqlMutationViaApi', 'data-api facade 必须导出 executeSqlMutationViaApi');

    assertIncludes(repository, "from '../db-bridge.js';", 'SQL repository 必须通过 db-bridge 访问数据库 API');
    assertIncludes(repository, "from './mutation-queue.js';", 'SQL repository 必须导入 mutation queue');
    assertIncludes(repository, "from './mutation-settlement.js';", 'SQL repository 必须导入共享 mutation settlement normalizer');
    assertIncludes(repository, "enqueueTableMutation('executeSqlMutationViaApi'", 'SQL mutation 必须进入 enqueueTableMutation');
    assertIncludes(repository, 'api.querySql', 'querySqlViaApi 必须优先支持 querySql');
    assertIncludes(repository, 'api.executeSqlQuery', 'querySqlViaApi 必须支持 executeSqlQuery fallback');
    assertIncludes(repository, 'api.executeSqlMutation', 'executeSqlMutationViaApi 必须调用 executeSqlMutation');
    assertIncludes(repository, 'callMutationApiToSettlement(', 'executeSqlMutationViaApi 必须等待 mutation 真实 settlement');
    assertIncludes(repository, 'normalizeSqlMutationSettlement(result)', 'executeSqlMutationViaApi 必须通过共享 normalizer 解释底层 settlement');
    assertNotIncludes(repository, 'function normalizeMutationResult(', 'SQL repository 不得重新内联私有 mutation normalizer');

    assertIncludes(repository, "buildFailure('sqlite_unavailable'", 'query null 必须判定 sqlite_unavailable');
    assertIncludes(repository, "buildFailure('mutation_rejected'", 'mutation API reject 必须判定 mutation_rejected');
    assertIncludes(repository, "rowCount: 0", '失败结构必须稳定提供 rowCount: 0');
    assertIncludes(repository, "SQL 查询返回错误", 'query errors 非空必须失败，不能污染 signature 状态机');
    assertIncludes(repository, "SQL 查询未确认成功", 'query success:false 必须失败，不能当作空查询成功');
    assertIncludes(repository, "SQL 查询未确认保存/读取状态", 'query saved:false 必须失败，不能当作稳定 signature');

    assertIncludes(mutationSettlement, "buildMutationFailure('mutation_result_null'", '共享 normalizer 必须区分 mutation null');
    assertIncludes(mutationSettlement, "buildMutationFailure('mutation_result_invalid'", '共享 normalizer 必须拒绝非法 mutation 返回');
    assertIncludes(mutationSettlement, "buildMutationFailure('mutation_failed'", '共享 normalizer 必须识别底层 errors');
    assertIncludes(mutationSettlement, "buildMutationFailure('save_failed'", '共享 normalizer 必须识别 saved:false');
    assertIncludes(mutationSettlement, 'result === undefined', '共享 normalizer 必须拒绝 undefined');
    assertIncludes(mutationSettlement, "typeof result !== 'object'", '共享 normalizer 必须拒绝非对象');
    assertIncludes(mutationSettlement, "!('errors' in result) || !Array.isArray(result.errors)", '共享 normalizer 必须要求正式 errors 数组');
    assertIncludes(mutationSettlement, 'Number.isInteger(result.changes)', '共享 normalizer 的 changes 必须是 number 类型整数');
    assertIncludes(mutationSettlement, 'result.changes < 0', '共享 normalizer 必须拒绝负数 changes');
    assertIncludes(mutationSettlement, "'ok' in result && result.ok === false", '共享 normalizer 必须识别 ok:false');
    assertIncludes(mutationSettlement, "'success' in result && result.success === false", '共享 normalizer 必须识别 success:false');
    assertIncludes(mutationSettlement, 'readFailureCode', '共享 normalizer 必须保留合法的底层失败 code');
    assertIncludes(mutationSettlement, 'readFailureMessage', '共享 normalizer 必须保留合法的底层失败 message');
    assertIncludes(mutationSettlement, 'changes: result.changes', 'changes=0 不能被当作失败，必须原样返回');

    const mutationFunction = repository.slice(repository.indexOf('export async function executeSqlMutationViaApi'));
    assertNotIncludes(mutationFunction, 'callApiWithTimeout(', 'SQL mutation 禁止使用 hard timeout');
    assertNotIncludes(mutationFunction, 'DEFAULT_API_TIMEOUT', 'SQL mutation 禁止依赖 query timeout 常量');


    assertNotIncludes(repository, 'executeSqlBatch', 'SQL repository 禁止 executeSqlBatch');
    assertNotIncludes(repository, 'api.executeSql(', 'SQL repository 禁止 executeSql 自动分流');
    assertNotIncludes(repository, 'refreshDataAndWorldbook', 'SQL repository 不得额外刷新数据库投影');
    assertNotIncludes(repository, 'window.parent', 'SQL repository 不得直接访问 window.parent');
    assertNotIncludes(repository, 'AutoCardUpdaterAPI', 'SQL repository 不得直接访问 AutoCardUpdaterAPI');
    assertNotIncludes(repository, 'trackingSheetKeys', 'SQL repository 默认不得传 trackingSheetKeys');
    assertNotIncludes(repository, 'trackingKeys', 'SQL repository 默认不得传 trackingKeys');
    assertNotIncludes(repository, 'targetSheetKeys', 'SQL repository 默认不得传 targetSheetKeys');
    assertNotIncludes(repository, 'skipSave', 'SQL repository 默认不得传 skipSave');
    assertNotIncludes(repository, 'skipChatSave', 'SQL repository 默认不得传 skipChatSave');
    assertNotIncludes(repository, 'isImportMode', 'SQL repository 默认不得传 isImportMode');
    assertNotIncludes(repository, 'skipNotify', 'SQL repository 默认不得传 skipNotify');
    assertNotIncludes(repository, 'isSilent', 'SQL repository 默认不得传 isSilent');
    assertNotIncludes(repository, 'suppressNotify', 'SQL repository 默认不得传 suppressNotify');
    assertNotIncludes(repository, 'silent: true', 'SQL repository 默认不得 silent: true');

    console.log('[通过] 纪要 today_relation SQL repository 合同：data-api facade、mutation queue、返回值归一化、默认刷新/追踪选项边界通过');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
