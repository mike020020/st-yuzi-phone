const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
    const {
        createMessageMenuController,
        createQuoteDrafts,
        copyMessageText,
        quotePreviewText,
        submitQuotedTextMessage,
    } = await import('../modules/qq-v2/ui/message-menu.js');

    const source = Object.freeze({
        messageId: 'message-7',
        type: 'text',
        content: 'The original message',
    });

    const copied = [];
    await copyMessageText(source, { writeText: async (value) => copied.push(value) });
    assert.deepEqual(copied, ['The original message']);
    assert.deepEqual(source, {
        messageId: 'message-7',
        type: 'text',
        content: 'The original message',
    }, 'copy must not rewrite the message');

    const quotes = createQuoteDrafts();
    assert.equal(quotes.select('conversation-1', source), true);
    assert.deepEqual(quotes.get('conversation-1'), {
        messageId: 'message-7',
        content: 'The original message',
    });
    assert.equal(quotePreviewText({ status: 'deleted', messageId: 'message-7', content: '' }), '原消息已删除');

    const sent = [];
    const facade = {
        intent: {
            async sendMessage(input) {
                sent.push(input);
                return { ok: true, status: 'accepted' };
            },
        },
    };
    const result = await submitQuotedTextMessage({
        facade,
        conversationId: 'conversation-1',
        content: 'Reply without copying the source',
        quotes,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(sent, [{
        conversationId: 'conversation-1',
        message: {
            type: 'text',
            content: 'Reply without copying the source',
            quoteMessageId: 'message-7',
        },
    }], 'quote must cross the public Facade as a stable message ID');
    assert.equal(quotes.get('conversation-1'), null, 'a successful send closes the quote preview');

    const opened = [];
    const scheduled = [];
    let timestamp = 0;
    const menu = createMessageMenuController({
        open: (payload) => opened.push(payload),
        now: () => timestamp,
        setTimeoutFn: (callback) => {
            scheduled.push(callback);
            return callback;
        },
        clearTimeoutFn: (callback) => {
            const index = scheduled.indexOf(callback);
            if (index >= 0) scheduled.splice(index, 1);
        },
    });
    menu.handlePointerDown({ pointerType: 'touch', pointerId: 3 }, { conversationId: 'conversation-1', message: source });
    assert.equal(scheduled.length, 1, 'touch starts a long-press timer');
    scheduled.shift()();
    assert.deepEqual(opened, [{ conversationId: 'conversation-1', message: source }]);

    let prevented = false;
    timestamp = 1000;
    menu.handleContextMenu({ preventDefault: () => { prevented = true; } }, { conversationId: 'conversation-1', message: source });
    assert.equal(prevented, true, 'desktop right-click must not open the browser menu');
    assert.equal(opened.length, 2, 'desktop right-click opens the same message menu');

    const appSource = await fs.readFile(path.join(__dirname, '../modules/qq-v2/ui/app.js'), 'utf8');
    assert.match(appSource, /from '\.\/message-menu\.js'/, 'the QQ App must use the message menu controller');
    assert.match(appSource, /handleContextMenu\(/, 'the rendered message must support desktop right-click');
    assert.match(appSource, /handlePointerDown\(/, 'the rendered message must support touch long-press');
    assert.doesNotMatch(appSource, /submitQuotedTextMessage\(/, 'private chat text submission must not attach quote IDs');
    assert.doesNotMatch(appSource, /yuzi-qq-quote-preview/, 'private chat must not expose a quote preview');
    assert.doesNotMatch(appSource, /createButton\('引用'/, 'private chat message menus must not expose quote actions');
    assert.doesNotMatch(appSource, /drafts\.set\(conversationId, `> \$\{messageContent\(message\)\}/, 'quote must not paste source text into the draft');

    console.log('[qq-message-menu-contract] passed');
}

main().catch((error) => {
    console.error('[qq-message-menu-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
