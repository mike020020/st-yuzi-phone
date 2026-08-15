import assert from 'node:assert/strict';
import test from 'node:test';

import { createScopeHost } from '../../modules/public-api/current-scope.js';
import { createRenderContext } from '../../modules/public-api/scene-context.js';

const initialScope = {
    scopeId: 'scope-a',
    chatId: 'chat-a',
    conversationId: 'conversation-a',
    userId: 'user-a',
    personId: 'person-a',
    displayName: 'Yuzi',
    route: 'public-app:wcmh',
    revision: 0,
};

test('a render context rejects a late result after its scope revision changes', async () => {
    const scopeHost = createScopeHost(initialScope);
    const renderContext = createRenderContext(scopeHost, 'wcmh.home');
    const lateRender = Promise.resolve().then(() => renderContext.assertCurrentRevision(renderContext.revision));

    scopeHost.replaceScope({ chatId: 'chat-b' });

    await assert.rejects(lateRender, (error) => error?.code === 'YUZI_SCOPE_STALE');
    assert.equal(renderContext.abortSignal.aborted, true);
    assert.equal(renderContext.isCurrent(0), false);
});

test('disposing a render context aborts once, detaches its scope listener, and rejects later assertions', () => {
    const scopeHost = createScopeHost(initialScope);
    const renderContext = createRenderContext(scopeHost, 'wcmh.home');
    let aborts = 0;
    renderContext.abortSignal.addEventListener('abort', () => { aborts += 1; });

    assert.equal(renderContext.dispose(), true);
    scopeHost.replaceScope({ chatId: 'chat-b' });

    assert.equal(renderContext.abortSignal.aborted, true);
    assert.equal(aborts, 1);
    assert.equal(renderContext.dispose(), false);
    assert.throws(
        () => renderContext.assertCurrentRevision(0),
        (error) => error?.code === 'YUZI_SCENE_DISPOSED',
    );
});
