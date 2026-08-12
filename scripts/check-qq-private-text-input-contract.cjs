const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
    const {
        normalizeComposerSubmission,
        shouldSubmitComposerKey,
    } = await import('../modules/qq-v2/ui/composer.js');

    assert.deepEqual(normalizeComposerSubmission('  '), {
        ok: false,
        reason: 'empty',
        content: '',
    });
    assert.deepEqual(normalizeComposerSubmission('  keep surrounding spaces  '), {
        ok: true,
        reason: '',
        content: '  keep surrounding spaces  ',
    });

    assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false }), true);
    assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, isComposing: false }), false);
    assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: true }), false);
    assert.equal(shouldSubmitComposerKey({ key: 'a', shiftKey: false, isComposing: false }), false);

    const source = await fs.readFile(path.join(__dirname, '../modules/qq-v2/ui/app.js'), 'utf8');
    assert.match(source, /normalizeComposerSubmission\(value\)/, 'text submission must preserve non-empty source text');
    assert.match(source, /facade\.intent\.sendMessage\(/, 'text must use the existing single-message contract');
    assert.doesNotMatch(source, /composerSendPlan|pendingAttachments/, 'Q49-1 forbids a combined attachment draft');

    console.log('[qq-private-text-input-contract] passed');
}

main().catch((error) => {
    console.error('[qq-private-text-input-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
