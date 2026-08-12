const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

async function createRepository(options = {}) {
    const { createMemoryQQV2StateStore } = await importModule('modules/qq-v2/storage/state-store.js');
    const { createQQV2Repository } = await importModule('modules/qq-v2/domain/repository.js');
    return createQQV2Repository({ stateStore: createMemoryQQV2StateStore(), ...options });
}

function image(label) {
    return new Blob([label], { type: 'image/png' });
}

async function testRefinementDefaultsAndExactContactRoute() {
    const repository = await createRepository();
    const scope = await repository.ensureScope('scope-a');
    assert.equal(scope.settings.hostContextTurns, 3, 'new QQ scopes default to three host-context turns');
    assert.equal(scope.settings.conversationHistoryLimit, 100, 'new QQ scopes default to one hundred private-history turns');
    assert.equal(scope.settings.proactive.everyTurns, 5, 'proactive messages keep the approved five-turn default');

    const first = await repository.createPrivateConversation('scope-a', { name: 'Alice' });
    const duplicate = await repository.createPrivateConversation('scope-a', { name: 'Alice' });
    const caseVariant = await repository.createPrivateConversation('scope-a', { name: 'alice' });
    const whitespaceVariant = await repository.createPrivateConversation('scope-a', { name: 'Alice ' });
    assert.equal(duplicate.created, false, 'only an exact existing name routes to that person');
    assert.equal(caseVariant.created, true, 'case variants are not normalized into an existing contact');
    assert.equal(whitespaceVariant.created, true, 'whitespace variants are not normalized into an existing contact');
    assert.notEqual(first.person.personId, caseVariant.person.personId);

    await repository.updateWorldbookSettings('scope-a', { enabled: false, keywords: ['keep'] });
    const global = await repository.getWorldbookSettings('scope-a');
    assert.deepEqual(global.keywords, ['keep'], 'blue/off worldbook settings preserve hidden keywords for a later green light');
}

async function testProfilesLibrariesAndReferenceFallback() {
    const repository = await createRepository({ random: () => 0 });
    await repository.ensureScope('scope-a');
    await repository.ensureScope('scope-b');
    const avatar = await repository.saveImageLibraryAsset('scope-a', { library: 'avatar', blob: image('avatar') });
    const chatBackground = await repository.saveImageLibraryAsset('scope-a', { library: 'chat-background', blob: image('chat') });
    const profileBackground = await repository.saveImageLibraryAsset('scope-a', { library: 'profile-background', blob: image('profile') });
    const created = await repository.createPrivateConversation('scope-a', { name: '???' });
    const createdInOtherScope = await repository.createPrivateConversation('scope-b', { name: 'Alice' });

    assert.equal(created.person.avatarAssetId, avatar.assetId, 'new contacts independently receive an avatar from the avatar library');
    assert.equal(created.person.profileBackgroundAssetId, profileBackground.assetId, 'new contacts independently receive a profile background');
    assert.equal(created.conversation.backgroundAssetId, chatBackground.assetId, 'new contacts independently receive a chat background');
    assert.equal(createdInOtherScope.person.avatarAssetId, avatar.assetId, 'image-library avatars are shared across host chats');
    assert.equal(createdInOtherScope.person.profileBackgroundAssetId, profileBackground.assetId, 'profile-background resources are shared across host chats');
    assert.equal(createdInOtherScope.conversation.backgroundAssetId, chatBackground.assetId, 'chat-background resources are shared across host chats');
    assert.deepEqual(
        (await repository.listImageLibraryAssets('scope-b', 'avatar')).map((asset) => asset.assetId),
        [avatar.assetId],
        'switching host chats keeps the same image library visible',
    );
    assert.equal((await repository.getMediaAsset('scope-b', avatar.assetId))?.assetId, avatar.assetId, 'shared library media renders from another host chat');
    const localOnly = await repository.saveScopeAsset('scope-a', { kind: 'avatar', blob: image('local-only') });
    assert.equal(await repository.getMediaAsset('scope-b', localOnly.assetId), null, 'ordinary profile uploads remain isolated to their host chat');

    const self = await repository.updateCurrentProfile('scope-a', {
        avatarAssetId: avatar.assetId,
        signature: '???',
        gender: '??',
        birthday: '8?8?',
        profileBackgroundAssetId: profileBackground.assetId,
    });
    assert.equal(self.signature, '???');
    assert.equal((await repository.getCurrentProfile('scope-a')).profileBackgroundAssetId, profileBackground.assetId);

    await repository.updatePrivateProfile('scope-a', created.conversation.conversationId, {
        signature: 'NPC ??',
        gender: '?',
        birthday: '2?29?',
        profileBackgroundAssetId: profileBackground.assetId,
        backgroundAssetId: '',
    });
    assert.equal((await repository.getPerson('scope-a', created.person.personId)).signature, 'NPC ??');
    assert.equal((await repository.getConversation('scope-a', created.conversation.conversationId)).backgroundAssetId, '', 'object-level removal only unlinks the current chat background');
    assert.equal((await repository.listImageLibraryAssets('scope-a', 'chat-background')).length, 1, 'object-level removal never deletes the shared library image');

    const removed = await repository.deleteImageLibraryAssets('scope-b', [avatar.assetId, profileBackground.assetId]);
    assert.deepEqual(removed.deletedAssetIds.sort(), [avatar.assetId, profileBackground.assetId].sort());
    assert.equal((await repository.getCurrentProfile('scope-a')).avatarAssetId, '', 'library deletion immediately restores current-user avatar fallback');
    assert.equal((await repository.getCurrentProfile('scope-a')).profileBackgroundAssetId, '', 'library deletion immediately restores current-user profile-background fallback');
    const person = await repository.getPerson('scope-a', created.person.personId);
    assert.equal(person.avatarAssetId, '', 'library deletion immediately restores NPC avatar fallback');
    assert.equal(person.profileBackgroundAssetId, '', 'library deletion immediately restores NPC profile-background fallback');
    const otherPerson = await repository.getPerson('scope-b', createdInOtherScope.person.personId);
    assert.equal(otherPerson.avatarAssetId, '', 'global library deletion clears cross-chat avatar references');
    assert.equal(otherPerson.profileBackgroundAssetId, '', 'global library deletion clears cross-chat profile-background references');
}


async function testCurrentProfileAvatarDrivesNewSelfMessages() {
    const repository = await createRepository();
    await repository.ensureScope('scope-a');
    const avatar = await repository.saveImageLibraryAsset('scope-a', {
        library: 'avatar',
        blob: image('self-avatar'),
    });
    await repository.updateCurrentProfile('scope-a', { avatarAssetId: avatar.assetId });
    const created = await repository.createPrivateConversation('scope-a', { name: 'Alice' });
    const [message] = await repository.appendMessages('scope-a', created.conversation.conversationId, [{
        senderId: '__self__',
        senderType: 'self',
        type: 'text',
        content: 'hello',
        senderAvatarAssetId: 'host-avatar',
    }]);

    assert.equal(
        message.senderAvatarAssetId,
        avatar.assetId,
        'new self messages prefer the persisted QQ-local profile avatar over the host fallback',
    );
}
async function testIndependentConversationInjectionOverrides() {
    const repository = await createRepository();
    const chat = await repository.createPrivateConversation('scope-a', { name: 'Alice' });
    await repository.appendMessages('scope-a', chat.conversation.conversationId, [{
        senderId: '__self__', senderType: 'self', type: 'text', content: 'hello', storyTime: '2042-05-01 10:00',
    }]);
    const books = { book: { entries: {} } };
    const { createQQV2WorldbookProjectionService } = await importModule('modules/qq-v2/worldbook/projection-service.js');
    const projection = createQQV2WorldbookProjectionService({
        repository,
        worldbookGateway: {
            async loadBook(name) { return structuredClone(books[name] || null); },
            async saveBook(name, book) { books[name] = structuredClone(book); },
        },
    });
    await projection.setGlobalSettings({
        scopeId: 'scope-a',
        settings: { enabled: true, bookName: 'book', timeWindow: { mode: 'all' }, light: 'green', depth: 9, keywords: ['global-key'] },
        userName: '???', storyTime: '2042-05-01 10:00',
    });
    await projection.setConversationInjection({
        scopeId: 'scope-a', conversationId: chat.conversation.conversationId,
        injection: { enabled: true, useConversationLight: true, light: 'blue', useConversationDepth: false },
        userName: '???', storyTime: '2042-05-01 10:00',
    });
    let entry = Object.values(books.book.entries)[0];
    assert.equal(entry.constant, true, 'conversation light override is independent from global light');
    assert.equal(entry.depth, 9, 'depth continues to inherit while only the light is overridden');
    assert.deepEqual(entry.key, [], 'blue lights omit keywords while retaining them in settings');

    await projection.setConversationInjection({
        scopeId: 'scope-a', conversationId: chat.conversation.conversationId,
        injection: { useConversationDepth: true, depth: 3, useConversationLight: false },
        userName: '???', storyTime: '2042-05-01 10:00',
    });
    entry = Object.values(books.book.entries)[0];
    assert.equal(entry.constant, false, 'removing the local light override immediately restores global green');
    assert.equal(entry.depth, 3, 'conversation depth override does not depend on its light setting');
    assert.deepEqual(entry.key, ['Alice', 'global-key']);
}

async function testFacadeExposesRefinementSeamsWithoutNormalizingNames() {
    const { createQQV2Facade } = await importModule('modules/qq-v2/application/facade.js');
    const calls = [];
    const runtime = {
        async getSnapshot() { return { phase: 'ready', context: { scopeId: 'scope-a', user: { name: '???', avatar: '' }, storyTime: '' }, globalSettings: {} }; },
        async getCurrentProfile() { return { avatarAssetId: '', signature: '???', gender: '', birthday: '', profileBackgroundAssetId: '' }; },
        async updateCurrentProfile(input) { calls.push(['updateCurrentProfile', input]); return input.profile; },
        async listImageLibraryAssets(input) { calls.push(['listImageLibraryAssets', input]); return []; },
        async saveImageLibraryAsset(input) { calls.push(['saveImageLibraryAsset', input]); return { assetId: 'asset-1', library: input.library, kind: 'avatar' }; },
        async deleteImageLibraryAssets(input) { calls.push(['deleteImageLibraryAssets', input]); return { deletedAssetIds: input.assetIds }; },
        async createPrivateConversation(input) {
            calls.push(['createPrivateConversation', input]);
            return { created: true, restored: false, person: { personId: 'person-1', formalName: input.name }, conversation: { conversationId: 'chat-1', kind: 'private' } };
        },
    };
    const facade = createQQV2Facade({ runtime });
    assert.equal((await facade.query.currentProfile()).profile.signature, '???');
    await facade.intent.updateCurrentProfile({ profile: { signature: '???' } });
    await facade.query.imageLibrary({ library: 'avatar' });
    await facade.intent.saveImageLibraryAsset({ library: 'avatar', blob: image('avatar') });
    await facade.intent.deleteImageLibraryAssets({ assetIds: ['asset-1'] });
    await facade.intent.createPrivateConversation({ name: 'Alice ' });
    assert.deepEqual(calls.at(-1), ['createPrivateConversation', { scopeId: 'scope-a', name: 'Alice ', userName: '???', storyTime: '' }], 'Facade preserves the literal contact name for exact-match routing');
}

async function main() {
    await testRefinementDefaultsAndExactContactRoute();
    await testProfilesLibrariesAndReferenceFallback();
    await testCurrentProfileAvatarDrivesNewSelfMessages();
    await testIndependentConversationInjectionOverrides();
    await testFacadeExposesRefinementSeamsWithoutNormalizingNames();
    console.log('[qq-figma-refinement-domain-contract] passed');
}

main().catch((error) => {
    console.error('[qq-figma-refinement-domain-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
