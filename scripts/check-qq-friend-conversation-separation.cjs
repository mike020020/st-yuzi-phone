const assert = require('node:assert/strict');

async function main() {
    const { createMemoryQQV2StateStore } = await import('../modules/qq-v2/storage/state-store.js');
    const { createQQV2Repository } = await import('../modules/qq-v2/domain/repository.js');
    const repository = createQQV2Repository({ stateStore: createMemoryQQV2StateStore() });
    const scopeId = 'st:friend-conversation-separation';
    const created = await repository.createPrivateConversation(scopeId, { name: 'Alice' });
    await repository.appendMessages(scopeId, created.conversation.conversationId, [{
        senderId: '__self__', senderType: 'self', type: 'text', content: 'History is removable.',
    }]);

    await repository.deleteConversation(scopeId, created.conversation.conversationId);
    const retained = await repository.getConversation(scopeId, created.conversation.conversationId);
    assert.equal(retained.status, 'contact', 'Deleting a chat must retain the independent friend relation');
    assert.equal((await repository.listMessages(scopeId, created.conversation.conversationId)).length, 0);
    assert.equal((await repository.getPerson(scopeId, created.person.personId)).formalName, 'Alice');

    const restored = await repository.createPrivateConversation(scopeId, { name: 'Alice' });
    assert.equal(restored.restored, true);
    assert.equal(restored.conversation.conversationId, created.conversation.conversationId);
    assert.equal(restored.conversation.status, 'active');
}

main().then(() => console.log('[qq-friend-conversation-separation] passed')).catch((error) => {
    console.error('[qq-friend-conversation-separation] failed');
    console.error(error);
    process.exitCode = 1;
});
