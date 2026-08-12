const assert = require('node:assert/strict');

async function main() {
    const { __test__ } = await import('../modules/qq-v2/ui/app.js');
    const calls = [];
    const facade = {
        query: {
            async conversations() {
                calls.push('conversations');
                return {
                    ok: true,
                    conversations: [
                        {
                            conversationId: 'empty-first', kind: 'private', status: 'active', title: 'Empty first', unreadCount: 0,
                        },
                        {
                            conversationId: 'yesterday', kind: 'private', status: 'active', title: 'Yesterday', unreadCount: 3,
                            lastMessage: { messageId: 'm-yesterday', type: 'voice', storyTime: '2042-05-19 07:20' },
                        },
                        {
                            conversationId: 'today', kind: 'private', status: 'active', title: 'Today', unreadCount: 120,
                            lastMessage: { messageId: 'm-today', type: 'text', content: 'Latest', storyTime: '2042-05-20 09:30' },
                        },
                        {
                            conversationId: 'group-hidden', kind: 'group', status: 'active', title: 'Must stay hidden',
                            lastMessage: { messageId: 'm-group', type: 'text', content: 'Must not render', storyTime: '2042-05-20 10:00' },
                        },
                        {
                            conversationId: 'contact-hidden', kind: 'private', status: 'contact', title: 'Contact only',
                        },
                        {
                            conversationId: 'same-time-a', kind: 'private', status: 'active', title: 'Same time A',
                            lastMessage: { messageId: 'm-same-a', type: 'image', storyTime: '2042-05-18 11:00' },
                        },
                        {
                            conversationId: 'same-time-b', kind: 'private', status: 'active', title: 'Same time B',
                            lastMessage: { messageId: 'm-same-b', type: 'transfer', storyTime: '2042-05-18 11:00' },
                        },
                        {
                            conversationId: 'video', kind: 'private', status: 'active', title: 'Video',
                            lastMessage: { messageId: 'm-video', type: 'video', storyTime: '2042-05-17 11:00' },
                        },
                        {
                            conversationId: 'sticker', kind: 'private', status: 'active', title: 'Sticker',
                            lastMessage: { messageId: 'm-sticker', type: 'sticker', storyTime: '2042-04-01 11:00' },
                        },
                        {
                            conversationId: 'missing-time', kind: 'private', status: 'active', title: 'No time',
                            lastMessage: { messageId: 'm-no-time', type: 'text', content: 'No clock', storyTime: '' },
                        },
                    ],
                };
            },
            async currentContext() {
                calls.push('currentContext');
                return { ok: true, context: { storyTime: '2042-05-20 10:00' } };
            },
        },
    };

    const model = await __test__.loadMessageRootModel(facade);
    assert.deepEqual(new Set(calls), new Set(['conversations', 'currentContext']));
    assert.deepEqual(model.rows.map((row) => row.conversation.conversationId), [
        'today', 'yesterday', 'same-time-a', 'same-time-b', 'video', 'sticker', 'missing-time', 'empty-first',
    ]);
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'today').preview, 'Latest');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'yesterday').preview, '[语音]');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'same-time-a').preview, '[图片]');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'video').preview, '[视频]');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'same-time-b').preview, '[转账]');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'sticker').preview, '[表情]');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'today').time, '09:30');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'yesterday').time, '昨天');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'same-time-a').time, '2天前');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'video').time, '3天前');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'sticker').time, '2042-04-01');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'missing-time').time, '');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'empty-first').preview, '');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'empty-first').time, '');
    assert.equal(model.rows.find((row) => row.conversation.conversationId === 'today').unreadLabel, '99+');

    const emptyModel = await __test__.loadMessageRootModel({
        query: {
            async conversations() { return { ok: true, conversations: [] }; },
            async currentContext() { return { ok: true, context: { storyTime: '2042-05-20 10:00' } }; },
        },
    });
    assert.equal(emptyModel.rows.length, 0, 'an empty message list must stay content-empty');
    assert.equal(emptyModel.chrome.hasSearch, true);
    assert.equal(emptyModel.chrome.hasPresence, true);
    assert.equal(emptyModel.chrome.hasAddMount, true);

    const anchor = __test__.planConversationListAnchor({
        previousConversationIds: ['alice', 'bravo', 'charlie'],
        nextConversationIds: ['new-top', 'alice', 'bravo', 'charlie'],
        anchorConversationId: 'bravo',
        previousScrollTop: 140,
        previousAnchorOffset: 12,
        nextAnchorOffset: 64,
    });
    assert.deepEqual(anchor, { conversationId: 'bravo', scrollTop: 192 });
    assert.equal(__test__.planConversationListAnchor({
        previousConversationIds: ['alice'],
        nextConversationIds: ['new-top'],
        anchorConversationId: 'alice',
        previousScrollTop: 20,
        previousAnchorOffset: 0,
        nextAnchorOffset: 20,
    }), null);

    const row = (conversationId, top, bottom) => ({
        dataset: { qqConversationId: conversationId },
        getBoundingClientRect: () => ({ top, bottom }),
    });
    const root = (rows, { top, bottom, scrollTop }) => ({
        scrollTop,
        querySelectorAll: () => rows,
        getBoundingClientRect: () => ({ top, bottom }),
    });
    const previousRoot = root([
        row('alice', 60, 100),
        row('bravo', 112, 152),
        row('charlie', 164, 204),
    ], { top: 100, bottom: 300, scrollTop: 140 });
    const capturedAnchor = __test__.captureConversationListAnchor(previousRoot);
    assert.deepEqual(capturedAnchor, {
        previousConversationIds: ['alice', 'bravo', 'charlie'],
        anchorConversationId: 'bravo',
        previousScrollTop: 140,
        previousAnchorOffset: 12,
    });

    const refreshedRoot = root([
        row('new-top', 112, 152),
        row('alice', 124, 164),
        row('bravo', 164, 204),
        row('charlie', 204, 244),
    ], { top: 100, bottom: 300, scrollTop: 0 });
    assert.equal(__test__.restoreConversationListAnchor(refreshedRoot, capturedAnchor), true);
    assert.equal(refreshedRoot.scrollTop, 192, 'refresh must retain the first visible conversation anchor');

    const staleRoot = root([
        row('new-top', 112, 152),
        row('alice', 124, 164),
        row('bravo', 164, 204),
        row('charlie', 204, 244),
    ], { top: 100, bottom: 300, scrollTop: 0 });
    let queuedRestore;
    __test__.scheduleConversationListAnchorRestore({
        anchor: capturedAnchor,
        token: 4,
        isActive: () => false,
        getRoot: () => staleRoot,
        enqueue: (callback) => { queuedRestore = callback; },
    });
    queuedRestore();
    assert.equal(staleRoot.scrollTop, 0, 'a stale render must not change the newest list scroll position');
}

main().then(() => console.log('[qq-message-root-contract] passed')).catch((error) => {
    console.error('[qq-message-root-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
