const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation.js');
const DERIVED_FIELD_SERVICE_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'derived-field-service.js');
const SQL_BUILDER_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation-sql.js');
const DATA_API_PATH = path.join(ROOT, 'modules', 'phone-core', 'data-api.js');
const SQL_REPOSITORY_PATH = path.join(ROOT, 'modules', 'phone-core', 'data-api', 'sql-repository.js');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(source, needle, message) {
    assert.ok(source.includes(needle), message);
}

function assertNotIncludes(source, needle, message) {
    assert.ok(!source.includes(needle), message);
}

async function main() {
    const source = read(SOURCE_PATH);
    const derivedFieldService = read(DERIVED_FIELD_SERVICE_PATH);
    const builder = read(SQL_BUILDER_PATH);
    const dataApi = read(DATA_API_PATH);
    const sqlRepository = read(SQL_REPOSITORY_PATH);
    const sourceModule = await import(pathToFileURL(SOURCE_PATH).href);
    const builderModule = await import(pathToFileURL(SQL_BUILDER_PATH).href);

    assertIncludes(source, 'querySqlViaApi', '派生器必须通过 data-api 查询 SQL signature');
    assertIncludes(source, 'queryTableRowsViaApi', '派生器必须通过 data-api 做别名感知的逻辑表列检查');
    assertIncludes(source, 'executeSqlMutationViaApi', '派生器必须通过 data-api 执行 SQL mutation');
    assertIncludes(source, 'buildChronicleTodayRelationSignatureSql', '派生器必须使用 signature SQL builder');
    assertIncludes(source, 'buildChronicleTodayRelationUpdateSql', '派生器必须使用 UPDATE SQL builder');
    assertIncludes(source, 'resolveChronicleTodayRelationContext', '派生器必须提供异步 context resolver');
    assertIncludes(source, 'resolveContext: resolveChronicleTodayRelationContext', '派生器必须把 context resolver 接入共享服务');
    assertIncludes(source, "tableName: 'chronicle'", 'context resolver 必须检查 chronicle 逻辑表');
    assertIncludes(source, 'columns: CHRONICLE_TODAY_RELATION_REQUIRED_COLUMNS', 'context resolver 必须用集中列契约检查 chronicle');
    assertIncludes(source, 'for (const anchorTable of CHRONICLE_TODAY_RELATION_ANCHOR_TABLES)', 'context resolver 必须按集中顺序检查锚点表');
    assertIncludes(source, 'columns: CHRONICLE_TODAY_RELATION_ANCHOR_REQUIRED_COLUMNS', 'context resolver 必须用集中列契约检查锚点表');
    assertIncludes(source, 'limit: 1', '逻辑表列检查必须使用最小读取范围');
    assertIncludes(source, 'maxSignatureRetry: 1', '纪要适配器必须配置一次有界 signature 重试');
    assertIncludes(derivedFieldService, 'const DEFAULT_MAX_SIGNATURE_RETRY = 1', '共享派生服务必须保留一次有界 signature 重试默认值');
    assertIncludes(derivedFieldService, 'for (let attempt = 0; attempt <= maxSignatureRetry; attempt += 1)', '共享派生服务必须按配置执行有界 signature 重试');
    assertIncludes(derivedFieldService, "typeof config.resolveContext === 'function'", '共享派生服务必须支持异步 context resolver');
    assertIncludes(derivedFieldService, 'await config.resolveContext(deps, {', '共享派生服务必须等待 context resolver 完成并传入暂停检查');
    assertIncludes(derivedFieldService, 'runtime.lastInputSignature', '共享派生服务必须保留输入签名缓存');
    assertIncludes(derivedFieldService, 'runtime.lastInvalidWarningSignature', '共享派生服务必须对 invalid warning 去重');
    assertIncludes(source, "from '../data-api.js'", '派生器必须只通过 data-api facade 调 repository');

    assertIncludes(dataApi, 'querySqlViaApi', 'data-api facade 必须导出 querySqlViaApi');
    assertIncludes(dataApi, 'queryTableRowsViaApi', 'data-api facade 必须导出 queryTableRowsViaApi');
    assertIncludes(dataApi, 'executeSqlMutationViaApi', 'data-api facade 必须导出 executeSqlMutationViaApi');
    assertIncludes(sqlRepository, 'export async function queryTableRowsViaApi(options = {})', 'SQL repository 必须提供 queryTableRows facade');
    assertIncludes(sqlRepository, 'api.queryTableRows', 'queryTableRows facade 必须调用数据库声明式单表查询');
    assertIncludes(sqlRepository, "normalizeReadDiagnostic(api, 'queryTableRows', startedAt)", 'queryTableRows facade 必须保留结构失败诊断');
    assertIncludes(source, 'CHRONICLE_TODAY_RELATION_ANCHOR_TABLES', '派生器必须复用集中 today anchor 表配置');
    assertIncludes(builder, 'export const CHRONICLE_TODAY_RELATION_ANCHOR_TABLES', 'SQL builder 必须导出集中 today anchor 表白名单配置');
    assertIncludes(builder, 'CHRONICLE_TODAY_RELATION_ANCHOR_REQUIRED_COLUMNS', 'SQL builder 必须集中声明 today anchor 统一所需列');
    assertIncludes(source, 'schema-blocked', '派生器必须在 schema 不完整时安全阻断');
    assertIncludes(source, "'runtime_not_ready'", '派生器必须把 runtime 暂不可用与结构缺失分开处理');
    assertIncludes(source, "'alias_conflict'", '派生器必须把别名冲突视为结构阻断');
    assertIncludes(source, "'table_not_found'", '派生器必须识别逻辑表缺失');
    assertIncludes(source, "'column_not_resolved'", '派生器必须识别逻辑列缺失');
    assertIncludes(builder, 'normalizeChronicleTodayRelationAnchorTable', 'SQL builder 必须校验 today anchor 表名');
    assert.deepStrictEqual(
        builderModule.CHRONICLE_TODAY_RELATION_ANCHOR_TABLES,
        ['global_state', 'current_status'],
        'today anchor 英文物理表名白名单必须集中维护并保持 global_state/current_status 优先级',
    );
    assert.deepStrictEqual(
        builderModule.CHRONICLE_TODAY_RELATION_ANCHOR_REQUIRED_COLUMNS,
        ['row_id', 'cur_time'],
        'today anchor 统一 schema 要求必须集中声明 row_id/cur_time',
    );
    assert.strictEqual(typeof sourceModule.resolveChronicleTodayRelationContext, 'function', '派生器必须导出 context resolver 供行为合同直接验证');
    assertIncludes(builder, 'cur_time', 'SQL builder 必须读取 today anchor 表 cur_time');
    assertIncludes(builder, 'FROM chronicle', 'SQL builder 必须读取 chronicle');
    assertIncludes(builder, 'time_span', 'SQL builder 必须读取 chronicle.time_span');
    assertIncludes(builder, 'UPDATE chronicle', 'SQL builder 必须保留清晰 UPDATE chronicle');
    assertIncludes(builder, 'today_relation', 'SQL builder 必须更新 chronicle.today_relation');

    assertNotIncludes(source, 'updateTableCell', '派生器不得继续逐行调用 updateTableCell');
    assertNotIncludes(source, 'date-relation.js', '派生器不得继续依赖 JS date-relation 计算链路');
    assertNotIncludes(source, 'getTableData', '派生器不得继续读取 JS 表快照计算派生字段');
    assertNotIncludes(source, 'processTableData', '派生器不得继续解析 JS 表快照计算派生字段');
    assertNotIncludes(source, 'collectChronicleUpdates', '旧 JS collectChronicleUpdates 必须移除');
    assertNotIncludes(source, 'applyChronicleUpdates', '旧 JS applyChronicleUpdates 必须移除');
    assertNotIncludes(source, 'AutoCardUpdaterAPI', '业务派生器不得直接访问 AutoCardUpdaterAPI');
    assertNotIncludes(source, 'window.parent', '业务派生器不得直接访问 window.parent');
    assertNotIncludes(source, 'executeSqlBatch', '派生链路禁止 executeSqlBatch');
    assertNotIncludes(source, 'executeSql(', '派生链路禁止 executeSql 自动分流');
    assertNotIncludes(source, '小日历表', '与今天关系派生不得把小日历表作为 today anchor 来源');
    ['sqlite_master', 'pragma_table_info', 'probeSqliteCapabilityViaApi', 'buildChronicleTodayRelationSchemaGateSql', 'buildChronicleTodayRelationAnchorTableSql'].forEach((needle) => {
        assertNotIncludes(`${source}\n${builder}`, needle, `纪要派生链路不得保留旧物理 schema 探测：${needle}`);
    });

    console.log('[通过] 纪要与今天关系锚点合同：queryTableRows 逻辑表列检查、异步 context resolver、锚点优先级、批量 UPDATE、无旧物理 probe');
}

try {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
