const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

function metadata(overrides = {}) {
    return {
        scopeId: 'st:character:alice.png:chat-a.jsonl',
        hostType: 'character',
        hostId: 'alice.png',
        chatId: 'chat-a',
        chatFile: 'chat-a.jsonl',
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
            for (const listener of listeners.get(eventName) || []) listener(...args);
        },
    };
}

async function testDeletionResolutionIsExactAndDiagnostic() {
    const {
        createHostChatDeletedFact,
        resolveDeletedQQV2Scope,
    } = await importModule('modules/qq-v2/host/lifecycle.js');
    const alice = metadata();
    const bob = metadata({
        scopeId: 'st:character:bob.png:chat-a.jsonl',
        hostId: 'bob.png',
    });
    const group = metadata({
        scopeId: 'st:group:group-1:group-chat-1',
        hostType: 'group',
        hostId: 'group-1',
        chatId: 'group-chat-1',
        chatFile: 'group-chat-1',
    });

    const ambiguous = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('character', 'chat-a'),
        [alice, bob, group],
    );
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual(ambiguous.candidateScopeIds, [alice.scopeId, bob.scopeId]);
    assert.equal(ambiguous.deletedChatId, 'chat-a');
    assert.equal(Object.hasOwn(ambiguous, 'scope'), false);

    const preferredCharacter = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('character', 'chat-a.jsonl', { hostId: 'bob.png' }),
        [alice, bob, group],
    );
    assert.equal(preferredCharacter.status, 'ambiguous');
    assert.deepEqual(preferredCharacter.candidateScopeIds, [alice.scopeId, bob.scopeId]);
    assert.deepEqual(preferredCharacter.preferredCandidateScopeIds, [bob.scopeId]);

    const staleCurrentHostHint = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('character', 'chat-a.jsonl', { hostId: 'current-card.png' }),
        [alice, group],
    );
    assert.equal(staleCurrentHostHint.status, 'matched');
    assert.equal(staleCurrentHostHint.match, 'unique-filename');
    assert.equal(staleCurrentHostHint.scope.scopeId, alice.scopeId);

    const duplicateMetadata = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('character', 'chat-a', { hostId: 'alice.png' }),
        [alice, alice],
    );
    assert.equal(duplicateMetadata.status, 'matched');

    const noFuzzyMatch = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('character', 'chat'),
        [alice],
    );
    assert.equal(noFuzzyMatch.status, 'not-found');

    const exactGroup = resolveDeletedQQV2Scope(
        createHostChatDeletedFact('group', 'group-chat-1'),
        [alice, group],
    );
    assert.equal(exactGroup.status, 'matched');
    assert.equal(exactGroup.scope.scopeId, group.scopeId);
}

async function testChatChangedFactNamesProjectionBoundaries() {
    const { createHostChatChangedFact } = await importModule('modules/qq-v2/host/lifecycle.js');
    const previousScope = metadata();
    const currentScope = metadata({
        scopeId: 'st:character:alice.png:chat-b.jsonl',
        chatId: 'chat-b',
        chatFile: 'chat-b.jsonl',
    });
    const changed = createHostChatChangedFact({ chatId: 'chat-b', previousScope, currentScope });

    assert.equal(changed.changed, true);
    assert.equal(changed.leftScopeId, previousScope.scopeId);
    assert.equal(changed.enteredScopeId, currentScope.scopeId);
    assert.equal(changed.currentScopeId, currentScope.scopeId);

    const unchanged = createHostChatChangedFact({ chatId: 'chat-b', previousScope: currentScope, currentScope });
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.leftScopeId, '');
    assert.equal(unchanged.enteredScopeId, '');
}

async function testDeletionEventsReachQQCallbacks() {
    const originalWindow = global.window;
    const originalDocument = global.document;
    const eventSource = createEventSource();
    const calls = [];
    let identity = { hostType: 'character', hostId: 'alice.png' };
    global.window = { eventSource, event_types: {} };
    global.document = { getElementById: () => null };

    try {
        const { registerPhoneEventListeners } = await importModule('modules/bootstrap/event-registry.js');
        await registerPhoneEventListeners({
            onQQV2ChatDeleted: (chatFile) => calls.push(['character', chatFile]),
            onQQV2GroupChatDeleted: (chatId) => calls.push(['group', chatId]),
            resolveQQV2HostIdentity: () => identity,
        });

        eventSource.emit('chat_deleted', 'private-chat-a');
        identity = { hostType: 'group', hostId: 'group-a' };
        eventSource.emit('group_chat_deleted', 'group-chat-a');
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepEqual(calls, [
            ['character', {
                kind: 'character-chat-deleted',
                hostType: 'character',
                hostId: 'alice.png',
                deletedChatId: 'private-chat-a',
                valid: true,
            }],
            ['group', {
                kind: 'group-chat-deleted',
                hostType: 'group',
                hostId: 'group-a',
                deletedChatId: 'group-chat-a',
                valid: true,
            }],
        ]);
    } finally {
        if (originalWindow === undefined) delete global.window;
        else global.window = originalWindow;
        if (originalDocument === undefined) delete global.document;
        else global.document = originalDocument;
    }
}

async function main() {
    await testDeletionResolutionIsExactAndDiagnostic();
    await testChatChangedFactNamesProjectionBoundaries();
    await testDeletionEventsReachQQCallbacks();
    console.log('[qq-v2-host-lifecycle-contract] passed');
}

main().catch((error) => {
    console.error('[qq-v2-host-lifecycle-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
