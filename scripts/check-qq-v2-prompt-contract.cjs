const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

async function testPlaceholdersHaveOneStableMeaningAndKeepUnknownText() {
    const { materializeQQV2PromptBlocks } = await importModule('modules/qq-v2/prompt/materializer.js');
    const blocks = [{
        role: 'system',
        content: '{{私聊人物}}|{{私聊主动人物}}|{{群聊成员}}|{{私聊记录}}|{{私聊主动记录}}|{{群聊记录}}|{{正文上下文}}|{{世界书内容}}|{{故事时间}}|{{可用表情}}|{{天气}}',
    }];
    const result = materializeQQV2PromptBlocks(blocks, {
        privatePerson: '林知夏',
        privateProactivePeople: 'P1：林知夏\nP2：顾言',
        groupMembers: '',
        privateHistory: '私聊历史',
        privateProactiveHistory: '全部私聊分区历史',
        groupHistory: '群聊历史',
        storyContext: '正文',
        worldbookContent: '世界书',
        storyTime: '2042-05-01 10:00',
        availableStickers: 'S1｜开心',
    });
    assert.deepEqual(result, [{
        role: 'system',
        content: '林知夏|P1：林知夏\nP2：顾言|无|私聊历史|全部私聊分区历史|群聊历史|正文|世界书|2042-05-01 10:00|S1｜开心|{{天气}}',
    }]);
}

async function testManualHistoryHasOneCurrentUserMessageAndProactiveDoesNotAppendRoles() {
    const { buildManualQQV2Request, buildProactiveQQV2Request } = await importModule('modules/qq-v2/prompt/materializer.js');
    const preset = { blocks: [{ role: 'system', content: '规则 {{私聊人物}}' }] };
    const history = [
        { senderType: 'self', content: '早一点' },
        { senderType: 'person', content: '收到' },
        { senderType: 'self', content: '最新一句' },
    ];
    const manual = buildManualQQV2Request({
        preset,
        variables: { privatePerson: '林知夏' },
        history,
    });
    assert.deepEqual(manual.map((message) => [message.role, message.content]), [
        ['system', '规则 林知夏'],
        ['user', '早一点'],
        ['assistant', '收到'],
        ['user', '最新一句'],
    ]);
    assert.equal(manual.filter((message) => message.content === '最新一句').length, 1);

    const proactive = buildProactiveQQV2Request({
        preset: { blocks: [{ role: 'user', content: '{{私聊记录}}|{{私聊主动记录}}' }] },
        variables: { privateProactiveHistory: '<private id="P1">历史</private>' },
        history,
    });
    assert.deepEqual(proactive, [{ role: 'user', content: '无|<private id="P1">历史</private>' }]);
}

async function testStickerCatalogUsesShortReferencesAndRemovesImageCode() {
    const {
        buildQQV2StickerCatalog,
        mapQQV2StickerActionReferences,
    } = await importModule('modules/qq-v2/prompt/sticker-catalog.js');
    const longImageCode = 'A'.repeat(120);
    const catalog = buildQQV2StickerCatalog([
        { id: 'sticker-uuid-a', description: '<img src="data:image/png;base64,AAAA"> 开心挥手' },
        { id: 'sticker-uuid-b', description: `blob:https://example.test/id ${longImageCode} 难过` },
    ]);

    assert.equal(catalog.text, 'S1｜开心挥手\nS2｜难过');
    assert.deepEqual(catalog.references, { S1: 'sticker-uuid-a', S2: 'sticker-uuid-b' });
    assert.doesNotMatch(catalog.text, /data:|blob:|<img|sticker-uuid|A{80}/u);
    assert.deepEqual(mapQQV2StickerActionReferences([{
        type: 'message',
        messageType: 'sticker',
        stickerId: 'S2',
    }], catalog.references), [{
        type: 'message',
        messageType: 'sticker',
        stickerId: 'sticker-uuid-b',
    }]);
}

async function testPromptHelpersKeepSuccessfulStoryTurnsAndEscapeProactiveSections() {
    const {
        buildQQV2StoryContext,
        buildQQV2ProactiveSections,
    } = await importModule('modules/qq-v2/prompt/materializer.js');

    const storyContext = buildQQV2StoryContext([
        { role: 'user', content: '**第一句**' },
        { role: 'assistant', content: '第一段回复' },
        { role: 'system', content: '不应出现' },
        { role: 'user', content: '第二句' },
        { role: 'assistant', content: '第二段回复' },
        { role: 'assistant', content: '失败回复', isSuccessful: false },
    ], 1);
    assert.equal(storyContext, '用户：第二句\n角色：第二段回复');

    const sections = buildQQV2ProactiveSections({
        kind: 'private',
        conversations: [{
            referenceId: 'P1',
            title: '林<知夏',
            personId: 'person-1',
            messages: [
                { senderType: 'self', content: '你好 & 再见' },
                { senderType: 'person', type: 'voice', content: '今晚见' },
                { senderType: 'self', type: 'image', content: '海边的照片' },
                { senderType: 'person', type: 'video', content: '烟花' },
                { senderType: 'self', type: 'sticker', content: '开心挥手' },
                {
                    senderType: 'self',
                    type: 'transfer',
                    transfer: {
                        amount: '88',
                        currency: '金币',
                        recipientId: 'person-1',
                        status: 'pending',
                        note: '晚饭',
                    },
                },
            ],
        }],
    });
    assert.equal(
        sections,
        '<private id="P1" name="林&lt;知夏"><message id="P1-M1" sender="user" type="text">你好 &amp; 再见</message><message id="P1-M2" sender="npc" type="voice">语音：今晚见</message><message id="P1-M3" sender="user" type="image">图片：海边的照片</message><message id="P1-M4" sender="npc" type="video">视频：烟花</message><message id="P1-M5" sender="user" type="sticker">表情：开心挥手</message><message id="P1-M6" sender="user" type="transfer">转账，金额：88 金币，收款人：林&lt;知夏，状态：待收款，备注：晚饭</message></private>',
    );
}

async function testDualWorldbookLayerDeduplicatesAndExcludesQQProjection() {
    const { resolveQQV2WorldbookContext } = await importModule('modules/qq-v2/prompt/worldbook-context.js');
    const dryRunCalls = [];
    const result = await resolveQQV2WorldbookContext({
        activationSnapshot: [
            { bookName: '主书', uid: 1, content: '剧情条目', depth: 4, role: 'system' },
            { bookName: '主书', uid: 9, content: 'QQ 投影', qqMarker: 'qq-v2' },
        ],
        people: ['林知夏', '林知夏'],
        visibleHistory: ['你好'],
        runDryRun: async (request) => {
            dryRunCalls.push(request);
            return [
                { bookName: '主书', uid: 1, content: '重复剧情条目', depth: 4, role: 'system' },
                { bookName: '人物书', uid: 2, content: '人物条目', depth: 7, role: 'character' },
                { bookName: '人物书', uid: 3, content: '其他 QQ 投影', marker: { qq: true } },
            ];
        },
    });
    assert.equal(dryRunCalls.length, 1);
    assert.deepEqual(dryRunCalls[0], { layer: 'person', people: ['林知夏'], history: ['你好'] });
    assert.deepEqual(result.entries.map((entry) => [entry.bookName, entry.uid, entry.content]), [
        ['主书', 1, '剧情条目'],
        ['人物书', 2, '人物条目'],
    ]);
    assert.match(result.text, /剧情条目/);
    assert.match(result.text, /人物条目/);
}

async function testWorldbookFallsBackToStoryDryRunOnlyWithoutSnapshot() {
    const { resolveQQV2WorldbookContext } = await importModule('modules/qq-v2/prompt/worldbook-context.js');
    const calls = [];
    const result = await resolveQQV2WorldbookContext({
        people: ['夏树'],
        visibleHistory: ['在吗'],
        runDryRun: async (request) => {
            calls.push(request);
            return request.layer === 'story'
                ? [{ bookName: '剧情书', uid: 3, content: '剧情扫描结果' }]
                : [{ bookName: '人物书', uid: 4, content: '人物扫描结果' }];
        },
    });

    assert.deepEqual(calls, [
        { layer: 'story', people: ['夏树'], history: ['在吗'] },
        { layer: 'person', people: ['夏树'], history: ['在吗'] },
    ]);
    assert.deepEqual(result.entries.map((entry) => [entry.bookName, entry.uid, entry.source]), [
        ['剧情书', 3, 'story-dry-run'],
        ['人物书', 4, 'person-dry-run'],
    ]);
}

async function testWorldbookAcceptsNativeTavernActivatedEntryShape() {
    const { resolveQQV2WorldbookContext } = await importModule('modules/qq-v2/prompt/worldbook-context.js');
    const result = await resolveQQV2WorldbookContext({
        activationSnapshot: [{ world: '角色书', uid: 12, content: '酒馆原生激活条目', depth: 5, role: 0 }],
        runDryRun: async () => [],
    });

    assert.deepEqual(result.entries.map((entry) => [entry.bookName, entry.uid, entry.content, entry.role]), [
        ['角色书', 12, '酒馆原生激活条目', 'system'],
    ]);
}

async function main() {
    await testPlaceholdersHaveOneStableMeaningAndKeepUnknownText();
    await testManualHistoryHasOneCurrentUserMessageAndProactiveDoesNotAppendRoles();
    await testStickerCatalogUsesShortReferencesAndRemovesImageCode();
    await testPromptHelpersKeepSuccessfulStoryTurnsAndEscapeProactiveSections();
    await testDualWorldbookLayerDeduplicatesAndExcludesQQProjection();
    await testWorldbookFallsBackToStoryDryRunOnlyWithoutSnapshot();
    await testWorldbookAcceptsNativeTavernActivatedEntryShape();
    console.log('[qq-v2-prompt-contract] passed');
}

main().catch((error) => {
    console.error('[qq-v2-prompt-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
