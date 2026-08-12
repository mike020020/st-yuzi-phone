const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    routing: 'modules/phone-core/routing.js',
    debugTools: 'modules/phone-core/data-api/debug-tools.js',
    tableRepository: 'modules/phone-core/data-api/table-repository.js',
    mutationQueue: 'modules/phone-core/data-api/mutation-queue.js',
    lockRepository: 'modules/phone-core/data-api/lock-repository.js',
    scrollGuards: 'modules/phone-core/scroll-guards.js',
};

const REMOVED_FILES = {
    legacyTemplateStore: 'modules/phone-core/chat-support/template-store.js',
    aiInstructionStore: 'modules/phone-core/chat-support/ai-instruction-store.js',
    notifications: 'modules/phone-core/notifications.js',
    configRepository: 'modules/phone-core/data-api/config-repository.js',
    presetRepository: 'modules/phone-core/data-api/preset-repository.js',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function has(content, snippet) {
    return content.includes(snippet);
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey] || REMOVED_FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];

    check(results, 'notifications', '顶部通知 watcher 模块已删除，不再要求旧通知轮询日志契约', !exists(REMOVED_FILES.notifications));
    check(results, 'configRepository', '旧数据库配置仓库已删除，不再要求配置兼容日志契约', !exists(REMOVED_FILES.configRepository));
    check(results, 'presetRepository', '旧数据库预设仓库已删除，不再要求预设兼容日志契约', !exists(REMOVED_FILES.presetRepository));

    check(results, 'routing', 'routing 使用 scoped logger', has(contents.routing, "const logger = Logger.withScope({ scope: 'phone-core/routing', feature: 'route' });"));
    check(results, 'routing', 'routing route callback 失败使用结构化日志', has(contents.routing, "action: 'change.emit'"));

    check(results, 'debugTools', 'debug-tools 使用 scoped logger', has(contents.debugTools, "const logger = Logger.withScope({ scope: 'phone-core/data-api/debug-tools', feature: 'db-api' });"));
    check(results, 'debugTools', 'debug-tools 使用结构化调试快照日志', has(contents.debugTools, "action: 'api.debug'"));

    check(results, 'tableRepository', 'table-repository 使用 scoped logger', has(contents.tableRepository, "const logger = Logger.withScope({ scope: 'phone-core/data-api/table-repository', feature: 'db-api' });"));
    check(results, 'tableRepository', 'table-repository getTableData 使用结构化日志', has(contents.tableRepository, "action: 'table-data.get'"));
    check(results, 'tableRepository', 'table-repository updateRow 异常使用结构化日志', has(contents.tableRepository, "action: 'update-row.error'"));
    check(results, 'tableRepository', 'table-repository insertRow 异常使用结构化日志', has(contents.tableRepository, "action: 'insert-row.error'"));
    check(results, 'tableRepository', 'table-repository deleteRow 异常使用结构化日志', has(contents.tableRepository, "action: 'delete-row.error'"));
    check(results, 'tableRepository', 'table-repository 不再保留 saveTableData 结构化日志契约', !has(contents.tableRepository, "action: 'table-data.save'"));

    check(results, 'mutationQueue', 'mutation-queue 使用 scoped logger', has(contents.mutationQueue, "const logger = Logger.withScope({ scope: 'phone-core/data-api/mutation-queue', feature: 'db-api' });"));
    check(results, 'mutationQueue', 'mutation-queue 任务失败使用结构化日志', has(contents.mutationQueue, "action: 'mutation.run'"));

    check(results, 'lockRepository', 'lock-repository 使用 scoped logger', has(contents.lockRepository, "const logger = Logger.withScope({ scope: 'phone-core/data-api/lock-repository', feature: 'db-api' });"));
    check(results, 'lockRepository', 'lock-repository get lock state 使用结构化日志', has(contents.lockRepository, "action: 'lock.state.get'"));
    check(results, 'lockRepository', 'lock-repository toggle col 使用结构化日志', has(contents.lockRepository, "action: 'lock.col.toggle'"));

    check(results, 'legacyTemplateStore', 'legacy template-store 已删除，不再要求旧 CRUD 结构化日志契约', !exists(REMOVED_FILES.legacyTemplateStore));
    check(results, 'aiInstructionStore', '旧 AI 指令存储已删除，QQ 不再复用 chat-support 日志链', !exists(REMOVED_FILES.aiInstructionStore));

    check(results, 'scrollGuards', 'scroll-guards 使用 scoped logger', has(contents.scrollGuards, "const logger = Logger.withScope({ scope: 'phone-core/scroll-guards', feature: 'scroll-guards' });"));
    check(results, 'scrollGuards', 'scroll-guards 声明 ScrollDebug channel 常量', has(contents.scrollGuards, "const SCROLL_DEBUG_CHANNEL = 'ScrollDebug';"));
    check(results, 'scrollGuards', 'scroll-guards 继续保留 ScrollDebug 文本前缀', has(contents.scrollGuards, 'const message = `[${SCROLL_DEBUG_CHANNEL}] ${normalizedTitle}`;'));
    check(results, 'scrollGuards', 'scroll-guards 构造结构化 debug 上下文', has(contents.scrollGuards, 'debugChannel: SCROLL_DEBUG_CHANNEL'));
    check(results, 'scrollGuards', 'scroll-guards 使用结构化 scroll-debug 日志', has(contents.scrollGuards, "action: 'scroll-debug'"));

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[phone-core-structured-logging-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[phone-core-structured-logging-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
