function asText(value) {
    return String(value ?? '');
}

/**
 * Validate the draft without rewriting what the user typed. Whitespace-only
 * drafts are rejected, while non-empty drafts retain their original content.
 */
export function normalizeComposerSubmission(value) {
    const content = asText(value);
    if (!content.trim()) return Object.freeze({ ok: false, reason: 'empty', content: '' });
    return Object.freeze({ ok: true, reason: '', content });
}

export function shouldSubmitComposerKey(event = {}) {
    return event.key === 'Enter'
        && event.shiftKey !== true
        && event.isComposing !== true;
}
