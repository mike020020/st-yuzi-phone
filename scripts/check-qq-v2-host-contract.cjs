const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

function context(overrides = {}) {
    return {
        chatId: 'chat-a',
        chatFile: 'chat-a.jsonl',
        characterId: 'character-a',
        characters: [{ avatar: 'character-a.png', name: '角色 A' }],
        name1: '用户 A',
        user_avatar: 'user-a.png',
        chat: [],
        chatMetadata: {},
        ...overrides,
    };
}

function createEventSource() {
    const listeners = new Map();
    return {
        on(eventName, listener) {
            const registered = listeners.get(eventName) || new Set();
            registered.add(listener);
            listeners.set(eventName, registered);
        },
        removeListener(eventName, listener) {
            listeners.get(eventName)?.delete(listener);
        },
        emit(eventName, ...args) {
            for (const listener of listeners.get(eventName) || []) {
                listener(...args);
            }
        },
    };
}

function waitForAsyncEvents() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function testHostFactsAlwaysFollowCurrentContext() {
    const { createQQV2HostAdapter, QQV2HostError } = await importModule('modules/qq-v2/host/adapter.js');
    let current = context();
    const host = createQQV2HostAdapter({
        getContext: () => current,
        getStoryTime: () => '2042-05-01 09:30',
    });

    assert.deepEqual(host.readScope(), {
        scopeId: 'st:character:character-a:chat-a.jsonl',
        chatId: 'chat-a',
        chatFile: 'chat-a.jsonl',
        hostType: 'character',
        hostId: 'character-a',
    });
    assert.deepEqual(host.readUserIdentity(), {
        name: '用户 A',
        avatar: 'user-a.png',
    });
    assert.equal(host.readStoryTime(), '2042-05-01 09:30');

    current = context({
        chatId: 'chat-b',
        chatFile: 'chat-b.jsonl',
        groupId: 'group-b',
        characterId: '',
        name1: '用户 B',
        user_avatar: 'user-b.png',
    });

    assert.deepEqual(host.readScope(), {
        scopeId: 'st:group:group-b:chat-b.jsonl',
        chatId: 'chat-b',
        chatFile: 'chat-b.jsonl',
        hostType: 'group',
        hostId: 'group-b',
    });
    assert.deepEqual(host.readUserIdentity(), {
        name: '用户 B',
        avatar: 'user-b.png',
    });

    current = null;
    assert.throws(() => host.readScope(), QQV2HostError);
}

async function testChatIntegrityKeepsScopeStableAcrossFileRename() {
    const { createQQV2HostAdapter } = await importModule('modules/qq-v2/host/adapter.js');
    let current = context({
        chatFile: 'before-rename.jsonl',
        chatMetadata: { integrity: 'chat-integrity-a' },
    });
    const host = createQQV2HostAdapter({ getContext: () => current, getStoryTime: () => '' });

    const beforeRename = host.readScope();
    current = context({
        chatId: 'renamed-chat',
        chatFile: 'after-rename.jsonl',
        chatMetadata: { integrity: 'chat-integrity-a' },
    });
    const afterRename = host.readScope();

    assert.equal(beforeRename.scopeId, 'st:character:character-a:chat-integrity-a');
    assert.equal(afterRename.scopeId, beforeRename.scopeId);
    assert.equal(afterRename.chatFile, 'after-rename.jsonl');

    current = context({
        chatId: 'another-chat',
        chatFile: 'another-chat.jsonl',
        chatMetadata: { integrity: 'chat-integrity-b' },
    });
    assert.notEqual(host.readScope().scopeId, beforeRename.scopeId);
    assert.equal(host.readScope().scopeId, 'st:character:character-a:chat-integrity-b');
}

async function testHostReadsStoryTimeFromThePhoneStatusData() {
    const { createQQV2HostAdapter } = await importModule('modules/qq-v2/host/adapter.js');
    const statusData = { value: 'story-time-source' };
    const host = createQQV2HostAdapter({
        getContext: () => context(),
        getTableData: () => statusData,
        resolveStatusBarData: (rawData) => ({
            currentTime: rawData.value === 'story-time-source' ? '2042-05-01 09:30' : '',
        }),
    });

    assert.equal(host.readStoryTime(), '2042-05-01 09:30');

    const unavailable = createQQV2HostAdapter({
        getContext: () => context(),
        getTableData: () => null,
        resolveStatusBarData: () => ({}),
    });
    assert.equal(unavailable.readStoryTime(), '');
}

async function testHostListsCharacterChatFilesWithoutGuessingOnFailure() {
    const { createQQV2HostAdapter } = await importModule('modules/qq-v2/host/adapter.js');
    const requests = [];
    let response = {
        ok: true,
        async json() {
            return [
                { file_name: 'shared-name.jsonl' },
                { file_id: 'other-chat' },
                { file_name: 'shared-name.jsonl' },
            ];
        },
    };
    const host = createQQV2HostAdapter({
        getContext: () => context({
            getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        }),
        getStoryTime: () => '',
        async fetchImpl(url, options) {
            requests.push([url, options]);
            return response;
        },
    });

    assert.deepEqual(await host.listCharacterChatFiles('character-a.png'), {
        status: 'resolved',
        hostId: 'character-a.png',
        chatFiles: ['shared-name', 'other-chat'],
    });
    assert.equal(requests[0][0], '/api/characters/chats');
    assert.deepEqual(requests[0][1], {
        method: 'POST',
        headers: { 'X-CSRF-Token': 'token' },
        body: JSON.stringify({ avatar_url: 'character-a.png', simple: true }),
    });

    response = { ok: false, status: 503 };
    assert.deepEqual(await host.listCharacterChatFiles('character-a.png'), {
        status: 'unresolved',
        hostId: 'character-a.png',
        reason: 'request-failed',
        httpStatus: 503,
    });
}

async function testRuntimeLifecycleDoesNotRetainOldScope() {
    const { createQQV2HostAdapter } = await importModule('modules/qq-v2/host/adapter.js');
    const { createQQV2Runtime } = await importModule('modules/qq-v2/runtime/runtime.js');
    let current = context();
    const host = createQQV2HostAdapter({ getContext: () => current, getStoryTime: () => '' });
    const events = [];
    const runtime = createQQV2Runtime({
        host,
        onScopeChanged: (scope) => events.push(scope.scopeId),
    });

    assert.equal(runtime.getStatus().phase, 'idle');
    await runtime.initialize();
    assert.equal(runtime.getStatus().phase, 'ready');
    assert.equal(runtime.getStatus().scopeId, 'st:character:character-a:chat-a.jsonl');

    current = context({
        chatId: 'chat-b',
        chatFile: 'chat-b.jsonl',
        groupId: 'group-b',
        characterId: '',
    });
    await runtime.handleChatChanged();
    assert.equal(runtime.getStatus().scopeId, 'st:group:group-b:chat-b.jsonl');
    assert.deepEqual(events, [
        'st:character:character-a:chat-a.jsonl',
        'st:group:group-b:chat-b.jsonl',
    ]);

    runtime.destroy();
    runtime.destroy();
    assert.equal(runtime.getStatus().phase, 'destroyed');
}

async function testRuntimeEntryDeliversCurrentHostLifecycleFacts() {
    const { createQQV2HostAdapter } = await importModule('modules/qq-v2/host/adapter.js');
    const { createQQV2Runtime } = await importModule('modules/qq-v2/runtime/runtime.js');
    const { createQQV2RuntimeEntry } = await importModule('modules/qq-v2/runtime/default-runtime.js');
    let current = context({
        chat: [{ is_user: true, name: '用户 A', mes: '正文用户消息' }],
    });
    const host = createQQV2HostAdapter({
        getContext: () => current,
        getStoryTime: () => '2042-05-01 09:30',
    });
    const scopeChanges = [];
    const characterEvents = [];
    const worldbookEvents = [];
    const entry = createQQV2RuntimeEntry({
        createHostAdapter: () => host,
        createRuntime: (options) => createQQV2Runtime({
            ...options,
            onScopeChanged: (scope) => scopeChanges.push(scope.scopeId),
            onCharacterMessageRendered: (facts) => characterEvents.push({
                messageId: facts.messageId,
                generationType: facts.generationType,
            }),
            onWorldInfoActivated: (facts) => worldbookEvents.push(facts.entries.map((entry) => entry.uid)),
        }),
    });

    await entry.initialize();
    await entry.initialize();
    assert.deepEqual(scopeChanges, ['st:character:character-a:chat-a.jsonl']);

    const characterFacts = await entry.handleCharacterMessageRendered('message-1', 'normal');
    assert.equal(characterFacts.scope.scopeId, 'st:character:character-a:chat-a.jsonl');
    assert.equal(characterFacts.generationType, 'normal');
    assert.equal(characterFacts.storyTime, '2042-05-01 09:30');
    assert.equal(characterFacts.storyMessages[0].content, '正文用户消息');
    assert.deepEqual(characterEvents, [{ messageId: 'message-1', generationType: 'normal' }]);

    const worldbookFacts = await entry.handleWorldInfoActivated({
        allActivatedEntries: [{ uid: 7, content: '当前正文世界书' }],
    });
    assert.deepEqual(worldbookFacts.entries, [{ uid: 7, content: '当前正文世界书' }]);
    assert.deepEqual(worldbookEvents, [[7]]);
    assert.deepEqual(entry.getWorldInfoLifecycle().entries, [{ uid: 7, content: '当前正文世界书' }]);

    current = context({
        chatId: 'chat-b',
        chatFile: 'chat-b.jsonl',
        groupId: 'group-b',
        characterId: '',
    });
    await entry.handleChatChanged();
    assert.equal(entry.getWorldInfoLifecycle(), null);
    assert.deepEqual(scopeChanges, [
        'st:character:character-a:chat-a.jsonl',
        'st:group:group-b:chat-b.jsonl',
    ]);

    entry.destroy();
    assert.equal(entry.getStatus().phase, 'idle');
    await entry.initialize();
    assert.equal(entry.getStatus().phase, 'ready');
    assert.equal(scopeChanges.at(-1), 'st:group:group-b:chat-b.jsonl');
}

async function testBootstrapAndExtensionWireQQV2Events() {
    const originalWindow = global.window;
    const originalDocument = global.document;
    const eventSource = createEventSource();
    const calls = [];
    global.window = { eventSource, event_types: {} };
    global.document = { getElementById: () => null };

    try {
        const { registerPhoneEventListeners } = await importModule('modules/bootstrap/event-registry.js');
        await registerPhoneEventListeners({
            onQQV2ChatChanged: (chatId) => calls.push(['chat', chatId]),
            onQQV2CharacterMessageRendered: (messageId, generationType) => calls.push([
                'character',
                messageId,
                generationType,
            ]),
            onQQV2WorldInfoActivated: (entries) => calls.push(['worldbook', entries]),
        });

        const entries = [{ uid: 7, content: '正文激活条目' }];
        eventSource.emit('chat_id_changed', 'chat-v2');
        eventSource.emit('character_message_rendered', 'message-v2', 'normal');
        eventSource.emit('world_info_activated', entries);
        await waitForAsyncEvents();

        assert.deepEqual(calls, [
            ['chat', 'chat-v2'],
            ['character', 'message-v2', 'normal'],
            ['worldbook', entries],
        ]);

        const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
        const runtimeSource = fs.readFileSync(path.join(ROOT, 'modules/qq-v2/runtime/default-runtime.js'), 'utf8');
        assert.match(indexSource, /from '\.\/modules\/qq-v2\/runtime\/default-runtime\.js';/);
        assert.match(indexSource, /await initializeQQV2Runtime\(\);/);
        assert.match(indexSource, /destroyQQV2Runtime\(\);/);
        assert.match(indexSource, /onQQV2ChatChanged: handleQQV2ChatChanged/);
        assert.match(indexSource, /onQQV2CharacterMessageRendered: handleQQV2CharacterMessageRendered/);
        assert.match(indexSource, /onQQV2WorldInfoActivated: handleQQV2WorldInfoActivated/);
        assert.doesNotMatch(runtimeSource, /modules\/qq\//);
    } finally {
        if (originalWindow === undefined) delete global.window;
        else global.window = originalWindow;
        if (originalDocument === undefined) delete global.document;
        else global.document = originalDocument;
    }
}

async function testDefaultRuntimeExposesAndRecoversFromHostUnavailability() {
    const originalGetContext = global.getContext;
    let current = context();
    let runtime = null;
    global.getContext = () => current;

    try {
        runtime = await importModule('modules/qq-v2/runtime/default-runtime.js');
        await runtime.initializeQQV2Runtime();
        assert.equal(runtime.getQQV2RuntimeStatus().phase, 'ready');

        current = null;
        assert.equal(await runtime.handleQQV2ChatChanged(), null);
        assert.deepEqual(runtime.getQQV2RuntimeStatus(), {
            phase: 'unavailable',
            scopeId: '',
            worldbookScopeId: '',
            epoch: 2,
            errorCode: 'host_unavailable',
        });

        current = context({
            chatId: 'chat-recovered',
            chatFile: 'chat-recovered.jsonl',
            groupId: 'group-recovered',
            characterId: '',
        });
        const scope = await runtime.handleQQV2ChatChanged();
        assert.equal(scope.scopeId, 'st:group:group-recovered:chat-recovered.jsonl');
        assert.equal(runtime.getQQV2RuntimeStatus().phase, 'ready');
    } finally {
        runtime?.destroyQQV2Runtime();
        if (originalGetContext === undefined) delete global.getContext;
        else global.getContext = originalGetContext;
    }
}

async function main() {
    await testHostFactsAlwaysFollowCurrentContext();
    await testChatIntegrityKeepsScopeStableAcrossFileRename();
    await testHostReadsStoryTimeFromThePhoneStatusData();
    await testHostListsCharacterChatFilesWithoutGuessingOnFailure();
    await testRuntimeLifecycleDoesNotRetainOldScope();
    await testRuntimeEntryDeliversCurrentHostLifecycleFacts();
    await testBootstrapAndExtensionWireQQV2Events();
    await testDefaultRuntimeExposesAndRecoversFromHostUnavailability();
    console.log('[qq-v2-host-contract] passed');
}

main().catch((error) => {
    console.error('[qq-v2-host-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
