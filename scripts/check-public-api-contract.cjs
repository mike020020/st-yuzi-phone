const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

async function main() {
    // 该脚本验证的是公开契约和生命周期边界，不依赖浏览器 DOM 或真实宿主环境。
    const moduleUrl = pathToFileURL(path.join(ROOT, 'modules/public-api/index.js')).href;
    const publicApi = await import(moduleUrl);
    const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const host = {};

    const api = publicApi.installYuziPhonePublicApi(host);
    assert.ok(api, 'install must create the public API');
    assert.equal(host.YuziPhoneAPI, api, 'API must be installed on the supplied host');
    assert.equal(api.getVersion(), '1.1.0');
    assert.equal(publicApi.installYuziPhonePublicApi(host), api, 'repeat install must be idempotent');

    // 每次读取能力都必须返回独立快照，防止调用方修改内部能力定义。
    const firstCapabilities = api.getCapabilities();
    const secondCapabilities = api.getCapabilities();
    assert.notEqual(firstCapabilities, secondCapabilities, 'capability snapshots must not expose internal storage');
    assert.deepEqual(
        firstCapabilities.map(({ name, available }) => [name, available]),
        [
            ['public-api.version', true],
            ['public-api.capabilities', true],
            ['app.register', true],
            ['scene.register', true],
            ['message.import', true],
            ['context.read', true],
            ['action.execute', true],
            ['transaction.execute', true],
        ],
    );
    assert.equal(api.hasCapability('public-api.version'), true);
    assert.equal(api.hasCapability('app.register'), true);
    assert.equal(api.hasCapability('scene.register'), true);
    assert.equal(api.hasCapability('unknown.capability'), false);
    assert.equal(typeof api.registerApp, 'function');
    assert.equal(typeof api.unregisterApp, 'function');
    assert.equal(typeof api.registerScene, 'function');
    assert.equal(typeof api.unregisterScene, 'function');
    assert.equal(typeof api.navigate, 'function');
    assert.equal(typeof api.refreshScene, 'function');
    assert.equal(typeof api.getMessageRuntime, 'function');
    assert.equal(typeof api.appendMessage, 'function');
    assert.equal(typeof api.importMessageHistory, 'function');
    assert.equal(typeof api.registerPromptContextProvider, 'function');
    assert.equal(typeof api.registerProactiveCandidateProvider, 'function');
    assert.equal(typeof api.registerActionHandler, 'function');
    assert.equal(typeof api.executeAction, 'function');
    assert.equal(typeof api.executeSqlTransaction, 'function');

    // App/Scene 注册和注销验证生命周期事件不会阻断宿主，并检查公开路由格式。
    const events = [];
    const listener = (event) => events.push(event.eventName);
    assert.equal(api.on('app.registered', listener), true);
    const scene = await api.registerScene({ sceneId: 'contract.scene', render: () => ({ title: 'Contract' }) });
    const app = await api.registerApp({ appId: 'contract.app', name: 'Contract app', sceneId: scene.sceneId });
    assert.equal(app.route, 'public-app:contract.app');
    assert.deepEqual(events, ['app.registered']);
    assert.equal(await api.unregisterApp('contract.app'), true);
    assert.equal(await api.unregisterScene('contract.scene'), true);
    assert.equal(api.off('app.registered', listener), true);

    // provider disposer、动作处理器和顶层输入冻结共同构成扩展接入边界。
    const removePrompt = api.registerPromptContextProvider(() => ({ source: 'contract', text: 'context' }));
    const removeProactive = api.registerProactiveCandidateProvider(() => [{ candidateId: 'candidate-1' }]);
    const removeAction = api.registerActionHandler('contract.action', ({ value }) => ({ value }));
    assert.deepEqual(await api.getPromptContext({}), [{ source: 'contract', text: 'context' }]);
    assert.deepEqual(await api.getProactiveCandidates({}), [{ candidateId: 'candidate-1' }]);
    assert.deepEqual(await api.executeAction('contract.action', { value: 1 }), { value: 1 });
    assert.equal(removePrompt(), true);
    assert.equal(removeProactive(), true);
    assert.equal(removeAction(), true);

    // 事务契约：所有 statement 合并为一次宿主 batch 调用，业务写入与 externalKey 收据
    // 不能降级为两个独立 executeSqlMutation 调用。
    const transactionCalls = [];
    publicApi.configureYuziPhonePublicApiRuntime({
        getSqlApi: () => ({
            async executeSqlBatch(request) {
                transactionCalls.push(request);
                return { success: true, changes: 2, errors: [] };
            },
        }),
    });
    const transactionResult = await api.executeSqlTransaction({
        statements: [
            { sql: 'INSERT INTO ledger (external_key, note, amount, enabled) VALUES (?, ?, ?, ?)', params: ['event-001', "O'Brien", 2.5, true] },
            { sql: 'INSERT INTO receipts (external_key) VALUES (?)', params: ['event-001'] },
        ],
        options: { targetSheetKeys: ['sheet_1', 'sheet_2'] },
    });
    assert.equal(transactionResult.success, true);
    assert.deepEqual(transactionCalls, [{
        sql: "INSERT INTO ledger (external_key, note, amount, enabled) VALUES ('event-001', 'O''Brien', 2.5, 1);\nINSERT INTO receipts (external_key) VALUES ('event-001')",
        targetSheetKeys: ['sheet_1', 'sheet_2'],
    }]);
    // SQL 文本、字符串或注释中的问号不是绑定点，只有代码区的 ? 才消耗一个参数。
    await api.executeSqlTransaction({
        statements: [{ sql: "INSERT INTO notes (body, template) VALUES (?, 'literal ?') -- comment ?", params: ['safe'] }],
    });
    assert.equal(transactionCalls[1].sql, "INSERT INTO notes (body, template) VALUES ('safe', 'literal ?') -- comment ?");
    // 参数不匹配必须在调用宿主前被拒绝，避免依赖底层的非一致错误形状。
    await assert.rejects(
        () => api.executeSqlTransaction({ statements: [{ sql: 'INSERT INTO receipts (external_key) VALUES (?)', params: ['event-001', 'unexpected'] }] }),
        (error) => error?.code === publicApi.PublicApiErrorCodes.INVALID_ARGUMENT,
    );
    // destroy 后不能继续写入旧 runtime；调用方得到明确的 API_UNAVAILABLE 降级信号。
    publicApi.destroyYuziPhonePublicApiRuntime();
    await assert.rejects(
        () => api.executeSqlTransaction({ statements: [{ sql: 'INSERT INTO receipts (external_key) VALUES (?)', params: ['event-001'] }] }),
        (error) => error?.code === publicApi.PublicApiErrorCodes.API_UNAVAILABLE,
    );

    const { createMemoryQQV2StateStore } = await import(pathToFileURL(path.join(ROOT, 'modules/qq-v2/storage/state-store.js')).href);
    const { createQQV2Repository } = await import(pathToFileURL(path.join(ROOT, 'modules/qq-v2/domain/repository.js')).href);
    const repository = createQQV2Repository({ stateStore: createMemoryQQV2StateStore() });
    await repository.ensureScope('scope-a');
    await repository.ensureScope('scope-b');
    const firstConversation = await repository.createPrivateConversation('scope-a', { name: 'External sender' });
    const secondConversation = await repository.createPrivateConversation('scope-b', { name: 'External sender' });
    const externalMessage = {
        externalKey: 'external-event-001',
        senderId: '__self__',
        senderType: 'self',
        type: 'text',
        content: 'Imported once',
    };
    // 相同 externalKey 在同一 scope+conversation 内必须幂等；换到另一会话则应重新导入。
    const imported = await repository.appendPublicMessages('scope-a', firstConversation.conversation.conversationId, [externalMessage]);
    const replayed = await repository.appendPublicMessages('scope-a', firstConversation.conversation.conversationId, [externalMessage]);
    assert.equal(imported[0].imported, true);
    assert.equal(replayed[0].imported, false);
    assert.equal(imported[0].message.messageId, replayed[0].message.messageId);
    const isolated = await repository.appendPublicMessages('scope-b', secondConversation.conversation.conversationId, [externalMessage]);
    assert.equal(isolated[0].imported, true, 'idempotency keys are isolated by QQ scope and conversation');

    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), true);
    assert.equal('YuziPhoneAPI' in host, false, 'destroy cleanup must remove the owned API');
    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), false, 'repeat cleanup must be idempotent');
    assert.equal(publicApi.installYuziPhonePublicApi(null), null, 'a missing browser host must be a no-op');

    const foreign = { getVersion: () => 'foreign' };
    host.YuziPhoneAPI = foreign;
    assert.equal(publicApi.installYuziPhonePublicApi(host), null, 'install must not replace another owner');
    assert.equal(host.YuziPhoneAPI, foreign);
    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), false, 'cleanup must preserve another owner');

    // 入口契约确保先取得单例所有权，再安装公开 API，并在失败/销毁路径清理。
    const guard = indexSource.indexOf('if (!acquireSingletonGuard()) return;');
    const install = indexSource.indexOf('installYuziPhonePublicApi(getInstanceHost());');
    const configure = indexSource.indexOf('configureErrorHandler({');
    assert.ok(guard >= 0 && install > guard && configure > install, 'entry must install after singleton ownership is acquired');
    assert.ok(indexSource.includes('uninstallYuziPhonePublicApi(getInstanceHost());'), 'failure and destroy paths must clean up the public API');

    console.log('[public-api-contract] passed');
}

main().catch((error) => {
    console.error('[public-api-contract] failed');
    console.error(error.stack || error);
    process.exitCode = 1;
});
