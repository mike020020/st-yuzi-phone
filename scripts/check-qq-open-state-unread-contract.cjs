const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
const { __test__ } = await import(pathToFileURL(path.join(__dirname, '..', 'modules', 'qq-v2', 'ui', 'app.js')).href);

assert.equal(typeof __test__.formatUnreadBadge, 'function', 'QQ must expose one shared unread badge formatter');
assert.equal(__test__.formatUnreadBadge(0), '', 'zero unread must hide the badge');
assert.equal(__test__.formatUnreadBadge(7), '7');
assert.equal(__test__.formatUnreadBadge(99), '99');
assert.equal(__test__.formatUnreadBadge(100), '99+');

assert.equal(typeof __test__.countIncomingJumpMessages, 'function', 'QQ must expose jump-count reconciliation seam');
const incoming = [
    { messageId: 'm1', senderType: 'person' },
    { messageId: 'm2', senderType: 'self' },
    { messageId: 'm3', senderType: 'person' },
];
assert.equal(__test__.countIncomingJumpMessages(incoming, new Set(['m1'])), 1);
assert.equal(__test__.countIncomingJumpMessages(incoming, new Set(['m1']), { atBottom: true }), 0);

const runtimeSource = await fs.readFile(path.join(__dirname, '..', 'modules', 'qq-v2', 'application', 'production-runtime.js'), 'utf8');
const facadeSource = await fs.readFile(path.join(__dirname, '..', 'modules', 'qq-v2', 'application', 'facade.js'), 'utf8');
const appSource = await fs.readFile(path.join(__dirname, '..', 'modules', 'qq-v2', 'ui', 'app.js'), 'utf8');
assert.match(runtimeSource, /async closeConversation\s*\(/, 'runtime must close the open session without cancelling requests');
assert.match(facadeSource, /async closeConversation\s*\(/, 'Facade must expose closeConversation');
assert.match(appSource, /closeConversation/, 'QQ UI must close the open session when leaving/destroying chat');

console.log('[qq-open-state-unread-contract] passed');
})().catch((error) => {
    console.error('[qq-open-state-unread-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
