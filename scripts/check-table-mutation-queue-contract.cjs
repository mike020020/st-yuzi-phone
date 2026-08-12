const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    repository: 'modules/phone-core/data-api/table-repository.js',
    queue: 'modules/phone-core/data-api/mutation-queue.js',
    importExport: 'modules/phone-core/data-api/import-export-repository.js',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];
    results.push({
        file: 'modules/phone-core/chat-support/message-projection.js',
        description: '旧消息记录表 projection 已删除，QQ 聊天不写入表格 mutation queue',
        ok: !fs.existsSync(path.join(ROOT, 'modules/phone-core/chat-support/message-projection.js')),
    });

    check(results, 'queue', 'mutation queue 暴露 enqueueTableMutation()', has(contents.queue, 'export function enqueueTableMutation('));
    check(results, 'queue', 'mutation queue 暴露 hasPendingTableMutations()', has(contents.queue, 'export function hasPendingTableMutations('));
    check(results, 'queue', 'mutation queue 暴露 getPendingTableMutationCount()', has(contents.queue, 'export function getPendingTableMutationCount('));

    check(results, 'repository', 'table-repository 导入 mutation-queue', has(contents.repository, "from './mutation-queue.js';"));
    check(results, 'repository', 'table-repository 不再导出 saveTableData() 整库写入入口', !has(contents.repository, 'export async function saveTableData'));
    check(results, 'repository', 'updateTableCell() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('updateTableCell'"));
    check(results, 'repository', 'updateTableRow() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('updateTableRow'"));
    check(results, 'repository', 'insertTableRow() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('insertTableRow'"));
    check(results, 'repository', 'insertTableRowsBatch() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('insertTableRowsBatch'"));
    check(results, 'repository', 'deleteTableRowViaApi() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('deleteTableRowViaApi'"));
    check(results, 'repository', 'deleteTableRowsBatch() 通过 enqueueTableMutation 串行化', has(contents.repository, "return enqueueTableMutation('deleteTableRowsBatch'"));
    check(results, 'repository', '所有 CRUD 使用真实 settlement helper', has(contents.repository, 'callMutationApiToSettlement('));
    check(results, 'repository', '正常 CRUD 不再调用手机端第二次刷新', !has(contents.repository, 'function refreshTableProjection(') && !has(contents.repository, 'refreshDataAndWorldbook'));
    check(results, 'repository', '批量插入不再接受本地 hard timeout 控制', !has(contents.repository, 'insertTimeoutMs'));

    check(results, 'importExport', '模板导入进入共享 mutation queue', has(contents.importExport, "enqueueTableMutation('importTemplateFromDataViaApi'"));
    check(results, 'importExport', '显式数据库投影刷新进入共享 mutation queue', has(contents.importExport, "enqueueTableMutation('refreshDatabaseProjectionViaApi'"));
    check(results, 'importExport', '模板导入和显式刷新等待真实 settlement', has(contents.importExport, 'callMutationApiToSettlement('));

    const failed = results.filter(item => !item.ok);
    if (failed.length > 0) {
        console.error('[table-mutation-queue-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[table-mutation-queue-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
