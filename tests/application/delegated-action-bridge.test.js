import assert from 'node:assert/strict';
import test from 'node:test';

import { createScopeHost } from '../../modules/public-api/current-scope.js';
import { createDelegatedActionBridge } from '../../modules/qq-v2/application/delegated-action-bridge.js';

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

class FakeElement {
    constructor(attributes = {}, children = []) {
        this.attributes = new Map(Object.entries(attributes));
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.value = attributes.value || '';
        this.checked = attributes.checked === true || attributes.checked === 'checked';
        for (const child of children) this.append(child);
    }

    append(child) {
        child.parentElement = this;
        this.children.push(child);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    contains(node) {
        for (let cursor = node; cursor; cursor = cursor.parentElement) {
            if (cursor === this) return true;
        }
        return false;
    }

    closest(selector) {
        if (selector !== '[data-action]') return null;
        for (let cursor = this; cursor; cursor = cursor.parentElement) {
            if (cursor.hasAttribute('data-action')) return cursor;
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector !== '[data-field]') return [];
        const fields = [];
        const visit = (element) => {
            if (element.hasAttribute('data-field')) fields.push(element);
            for (const child of element.children) visit(child);
        };
        visit(this);
        return fields;
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    emit(type, target) {
        const event = {
            target,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
        };
        this.listeners.get(type)?.(event);
        return event;
    }
}

test('delegated bridge sends a declared click with host identity and current revision', async () => {
    const root = new FakeElement({}, [new FakeElement({
        'data-action': 'feed.like',
        'data-field': 'postId',
        value: 'p1',
    })]);
    const calls = [];
    const bridge = createDelegatedActionBridge({
        sceneId: 'wcmh.feed',
        scopeHost: createScopeHost(initialScope),
        onAction: async (input) => calls.push(input),
    });
    bridge.mount({ root, actions: ['feed.like'] });

    const event = root.emit('click', root.children[0]);
    await event.yuziActionPromise;

    assert.equal(event.defaultPrevented, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].actionId, 'feed.like');
    assert.equal(calls[0].scope.scopeId, 'scope-a');
    assert.equal(calls[0].revision, 0);
    assert.equal(calls[0].payload.postId, 'p1');
    assert.equal(calls[0].payload.scopeId, 'scope-a');
});

test('delegated bridge submits declared form fields through the same action contract', async () => {
    const form = new FakeElement({ 'data-action': 'profile.save' }, [
        new FakeElement({ 'data-field': 'displayName', value: 'Yu Zi' }),
    ]);
    const root = new FakeElement({}, [form]);
    const calls = [];
    const bridge = createDelegatedActionBridge({
        sceneId: 'wcmh.profile',
        scopeHost: createScopeHost(initialScope),
        onAction: async (input) => calls.push(input),
    });
    bridge.mount({ root, actions: ['profile.save'] });

    const event = root.emit('submit', form);
    await event.yuziActionPromise;

    assert.equal(calls.length, 1);
    assert.equal(calls[0].actionId, 'profile.save');
    assert.equal(calls[0].payload.displayName, 'Yuzi');
    assert.equal(calls[0].payload.revision, 0);
});

test('delegated bridge rejects an undeclared action', async () => {
    const root = new FakeElement({}, [new FakeElement({ 'data-action': 'feed.delete' })]);
    const bridge = createDelegatedActionBridge({
        scopeHost: createScopeHost(initialScope),
        onAction: async () => {},
    });
    bridge.mount({ root, actions: ['feed.like'] });

    const event = root.emit('click', root.children[0]);
    await assert.rejects(event.yuziActionPromise, (error) => error?.code === 'YUZI_ACTION_NOT_DECLARED');
});

test('delegated bridge rejects a click after the mounted revision becomes stale', async () => {
    const root = new FakeElement({}, [new FakeElement({ 'data-action': 'feed.like' })]);
    const scopeHost = createScopeHost(initialScope);
    const bridge = createDelegatedActionBridge({
        scopeHost,
        onAction: async () => {},
    });
    bridge.mount({ root, actions: ['feed.like'], revision: 0 });
    scopeHost.replaceScope({ chatId: 'chat-b' });

    const event = root.emit('click', root.children[0]);
    await assert.rejects(event.yuziActionPromise, (error) => error?.code === 'YUZI_SCOPE_STALE');
});

test('delegated bridge rejects post-dispose dispatches', async () => {
    const bridge = createDelegatedActionBridge({
        scopeHost: createScopeHost(initialScope),
        onAction: async () => {},
    });
    bridge.dispose();

    await assert.rejects(
        bridge.dispatch({ actionId: 'feed.like', payload: {} }),
        (error) => error?.code === 'YUZI_SCENE_DISPOSED',
    );
});
