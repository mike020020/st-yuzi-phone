const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();
const importFromRoot = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

async function main() {
    const [{ installYuziPhonePublicApi, configureYuziPhonePublicApiRuntime, uninstallYuziPhonePublicApi, PublicApiErrorCodes }, { createMemoryQQV2StateStore }, { createQQV2Repository }, { createQQV2ProductionRuntime }] = await Promise.all([
        importFromRoot('modules/public-api/index.js'),
        importFromRoot('modules/qq-v2/storage/state-store.js'),
        importFromRoot('modules/qq-v2/domain/repository.js'),
        importFromRoot('modules/qq-v2/application/production-runtime.js'),
    ]);

    const stateStore = createMemoryQQV2StateStore();
    const repository = createQQV2Repository({ stateStore });
    await repository.ensureScope('scope-a');
    await repository.ensureScope('scope-b');
    const alice = await repository.createPrivateConversation('scope-a', { name: 'Alice' });
    const bob = await repository.createPrivateConversation('scope-a', { name: 'Bob' });
    const group = await repository.createGroupConversation('scope-a', {
        name: 'Study group',
        memberIds: [alice.person.personId, bob.person.personId],
    });
    const otherScope = await repository.createPrivateConversation('scope-b', { name: 'Other scope' });

    const runtimeOwner = createQQV2ProductionRuntime({
        host: { readScope: () => ({ scopeId: 'scope-a' }) },
        stateStore,
        repository,
        defaultImageLibrary: { ensureInstalled: async () => {} },
    });
    const yuziRuntime = runtimeOwner.getPublicMessageRuntime();
    const host = {};
    const api = installYuziPhonePublicApi(host);
    let activeScopeId = 'scope-a';
    configureYuziPhonePublicApiRuntime({ getMessageRuntime: () => ({ ...yuziRuntime, getActiveScopeId: () => activeScopeId }) });

    const appendMany = async (scopeId, conversationId, count, senderId = '__self__', prefix = 'private') => {
        for (let index = 0; index < count; index += 1) {
            await yuziRuntime.append({
                scopeId,
                conversationId,
                message: {
                    externalKey: `${prefix}-${index}`,
                    senderId,
                    senderType: senderId === '__self__' ? 'self' : 'person',
                    type: 'text',
                    content: `${prefix}-${index}`,
                    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
                    status: 'sent',
                },
            });
        }
    };

    await appendMany('scope-a', alice.conversation.conversationId, 105);
    await appendMany('scope-a', group.conversation.conversationId, 2, alice.person.personId, 'group');
    await yuziRuntime.append({
        scopeId: 'scope-b',
        conversationId: otherScope.conversation.conversationId,
        message: { externalKey: 'other-scope-0', senderId: '__self__', senderType: 'self', type: 'text', content: 'scope-b-only', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    await repository.incrementConversationUnread('scope-a', alice.conversation.conversationId, 3);

    const facade = api.getMessageRuntime('scope-a');
    const privateConversation = await facade.getCurrentConversation({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId });
    assert.deepEqual(privateConversation, { conversationId: alice.conversation.conversationId, type: 'private', title: 'Alice' });
    const recent = await facade.listMessages({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId });
    assert.equal(recent.length, 40);
    assert.equal(recent[0].body, 'private-65');
    assert.equal(recent.at(-1).body, 'private-104');
    assert.deepEqual(Object.keys(recent[0]).sort(), ['body', 'conversationId', 'createdAt', 'messageId', 'replyToMessageId', 'senderId', 'senderName', 'status']);
    assert.ok(recent.every((message, index) => index === 0 || recent[index - 1].createdAt <= message.createdAt));

    const capped = await facade.listMessages({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId, limit: 999 });
    assert.equal(capped.length, 100);
    const before = await facade.listMessages({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId, limit: 10, beforeMessageId: capped[5].messageId });
    assert.equal(before.length, 10);
    assert.equal(before.at(-1).body, 'private-9');
    await assert.rejects(() => facade.listMessages({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId, limit: 0 }), (error) => error?.code === PublicApiErrorCodes.INVALID_ARGUMENT);

    const groupConversation = await facade.getCurrentConversation({ scopeId: 'scope-a', conversationId: group.conversation.conversationId });
    assert.deepEqual(groupConversation, { conversationId: group.conversation.conversationId, type: 'group', title: 'Study group' });
    const groupMessages = await facade.listMessages({ scopeId: 'scope-a', conversationId: group.conversation.conversationId });
    assert.deepEqual(groupMessages.map(({ body }) => body), ['group-0', 'group-1']);
    const participants = await facade.listParticipants({ scopeId: 'scope-a', conversationId: group.conversation.conversationId });
    assert.deepEqual(participants.map(({ participantId, displayName, role }) => ({ participantId, displayName, role })), [
        { participantId: '__self__', displayName: '我', role: 'owner' },
        { participantId: alice.person.personId, displayName: 'Alice', role: 'member' },
        { participantId: bob.person.personId, displayName: 'Bob', role: 'member' },
    ]);
    assert.equal(await facade.getUnreadCount({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId }), 3);
    assert.equal(await facade.getUnreadCount({ scopeId: 'scope-a', conversationId: group.conversation.conversationId }), 0);
    assert.deepEqual((await facade.listMessages({ scopeId: 'scope-a', conversationId: group.conversation.conversationId })).map(({ body }) => body), ['group-0', 'group-1']);
    await assert.rejects(() => facade.getCurrentConversation({ scopeId: 'scope-a', conversationId: 'missing-conversation' }), (error) => error?.code === PublicApiErrorCodes.MESSAGE_CONVERSATION_NOT_FOUND);

    await assert.rejects(() => facade.listMessages({ scopeId: 'scope-b', conversationId: otherScope.conversation.conversationId }), (error) => error?.code === PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH);
    activeScopeId = 'scope-b';
    await assert.rejects(() => facade.listMessages({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId }), (error) => error?.code === PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH);
    const switchedFacade = api.getMessageRuntime('scope-b');
    assert.equal((await switchedFacade.listMessages({ scopeId: 'scope-b', conversationId: otherScope.conversation.conversationId }))[0].body, 'scope-b-only');
    await assert.rejects(() => facade.listMessages({ scopeId: 'scope-b', conversationId: alice.conversation.conversationId }), (error) => error?.code === PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH);

    const appended = await api.appendMessage({ scopeId: 'scope-a', conversationId: alice.conversation.conversationId, message: { externalKey: 'compat-append', senderId: '__self__', senderType: 'self', type: 'text', content: 'compat append' } });
    assert.equal(typeof appended.messageId, 'string');
    const imported = await api.importMessageHistory({ scopeId: 'scope-a', conversationId: bob.conversation.conversationId, messages: [{ externalKey: 'compat-import', senderId: '__self__', senderType: 'self', type: 'text', content: 'compat import' }] });
    assert.equal(imported.length, 1);
    assert.deepEqual(Object.keys(facade).sort(), ['append', 'getCurrentConversation', 'getUnreadCount', 'importHistory', 'listMessages', 'listParticipants']);
    assert.equal('indexedDB' in facade, false);
    assert.equal('repository' in facade, false);
    assert.equal('stateStore' in facade, false);

    uninstallYuziPhonePublicApi(host);
    runtimeOwner.destroy();
    console.log('[message-runtime-read-contract] passed');
}

main().catch((error) => {
    console.error('[message-runtime-read-contract] failed');
    console.error(error.stack || error);
    process.exitCode = 1;
});
