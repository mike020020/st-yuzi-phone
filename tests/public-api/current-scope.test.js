import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionContext, createScopeHost } from '../../modules/public-api/current-scope.js';
import * as publicApiModule from '../../modules/public-api/index.js';
import {
    configureYuziPhonePublicApiRuntime,
    destroyYuziPhonePublicApiRuntime,
    installYuziPhonePublicApi,
} from '../../modules/public-api/index.js';

const initialScope = Object.freeze({
    scopeId: 'scope-a',
    chatId: 'chat-a',
    conversationId: 'conversation-a',
    userId: 'user-a',
    personId: 'person-a',
    displayName: 'Yuzi',
    route: 'public-app:wcmh',
    revision: 0,
});

test('getCurrentScope returns a frozen complete WCMHConversationScope snapshot', () => {
    const scopeHost = createScopeHost(initialScope);
    const scope = scopeHost.getCurrentScope();

    assert.equal(Object.isFrozen(scope), true);
    assert.deepEqual(Object.keys(scope).sort(), [
        'chatId',
        'conversationId',
        'displayName',
        'personId',
        'revision',
        'route',
        'scopeId',
        'userId',
    ]);
    assert.deepEqual(scope, initialScope);
});

test('replaceScope publishes one replacement snapshot with the next revision', () => {
    const scopeHost = createScopeHost(initialScope);
    const events = [];
    const unsubscribe = scopeHost.on('scope.changed', (event) => events.push(event));

    const next = scopeHost.replaceScope({ chatId: 'chat-b', conversationId: 'conversation-b' });

    assert.equal(next.revision, 1);
    assert.equal(next.chatId, 'chat-b');
    assert.equal(scopeHost.getCurrentScope(), next);
    assert.notEqual(next, initialScope);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventName, 'scope.changed');
    assert.equal(events[0].scope, next);
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
});

test('replaceScope rejects a decreasing revision', () => {
    const scopeHost = createScopeHost({ ...initialScope, revision: 3 });

    assert.throws(
        () => scopeHost.replaceScope({ revision: 2 }),
        (error) => error?.code === 'YUZI_SCOPE_STALE',
    );
});

test('action context replaces forged identity fields with the host scope', () => {
    const scopeHost = createScopeHost(initialScope);
    const actionContext = createActionContext(scopeHost);
    const payload = actionContext.withPayload({
        scopeId: 'forged-scope',
        chatId: 'forged-chat',
        conversationId: 'forged-conversation',
        userId: 'other-user',
        personId: 'other-person',
        displayName: 'Other',
        route: 'forged-route',
        revision: 999,
        value: 1,
    });

    assert.equal(Object.isFrozen(payload), true);
    assert.equal(payload.value, 1);
    assert.deepEqual(
        Object.fromEntries(Object.keys(initialScope).map((key) => [key, payload[key]])),
        initialScope,
    );
});

test('public API advertises the scope lifecycle capabilities without removing existing event methods', () => {
    const api = installYuziPhonePublicApi({});

    assert.equal(api.hasCapability('context.currentScope'), true);
    assert.equal(api.hasCapability('scope.changed'), true);
    assert.equal(api.hasCapability('scene.renderContext'), true);
    assert.equal(api.hasCapability('scene.actionContext'), true);
    assert.equal(api.hasCapability('scene.controlled-html'), true);
    assert.equal(api.hasCapability('scene.delegated-action-bridge'), true);
    assert.equal(api.hasCapability('scene.render-lifecycle'), true);
    assert.equal(typeof api.getCurrentScope, 'function');
    assert.equal(typeof api.on, 'function');
    assert.equal(typeof api.off, 'function');
    assert.equal('getPublicScopeHost' in publicApiModule, false);
});

test('public API forwards scope.changed through its existing on and off methods', () => {
    const scopeHost = createScopeHost(initialScope);
    const api = installYuziPhonePublicApi({});
    const events = [];
    configureYuziPhonePublicApiRuntime({ scopeHost });

    assert.equal(api.on('scope.changed', (event) => events.push(event.scope)), true);
    const listener = (event) => events.push(event.scope);
    assert.equal(api.on('scope.changed', listener), true);
    const next = scopeHost.replaceScope({ chatId: 'chat-b' });

    assert.deepEqual(events, [next, next]);
    assert.equal(api.off('scope.changed', listener), true);
    scopeHost.replaceScope({ chatId: 'chat-c' });
    assert.equal(events.length, 3);
    destroyYuziPhonePublicApiRuntime();
});
