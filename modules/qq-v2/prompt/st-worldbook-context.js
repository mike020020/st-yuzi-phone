import { getFreshSillyTavernContext } from '../../integration/context-bridge.js';

function asText(value, maxLength = 0) {
    const text = String(value ?? '').trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function uniqueText(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((value) => asText(value, 4096)).filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function scanChat(people, history) {
    return [...uniqueText(history), ...uniqueText(people)].reverse();
}

function entriesOf(value) {
    if (value instanceof Map || value instanceof Set) return [...value.values()];
    if (Array.isArray(value)) return value;
    return [];
}

function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        bookName: asText(entry.world ?? entry.bookName ?? entry.worldbookName, 256),
        uid: entry.uid ?? entry.entryUid ?? entry.id ?? '',
        content: String(entry.content ?? ''),
        depth: entry.depth ?? null,
        role: entry.role ?? 'system',
        ...(entry.extensions ? { extensions: entry.extensions } : {}),
    };
}

function resolveContext(getContext) {
    let context = null;
    try {
        context = getContext();
    } catch {
        // The error below is the stable public surface for callers.
    }
    const eventSource = context?.eventSource;
    if (!context
        || typeof context.getWorldInfoPrompt !== 'function'
        || !eventSource
        || typeof eventSource.on !== 'function'
        || (typeof eventSource.removeListener !== 'function' && typeof eventSource.off !== 'function')) {
        throw new QQV2WorldbookContextError(
            '当前 SillyTavern 上下文不能执行世界书定向扫描',
            'worldbook_context_unavailable',
        );
    }
    return context;
}

function maxContextOf(context) {
    const value = Number(context?.maxContext);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 8192;
}

/**
 * Runs Tavern's own worldbook dry-run and captures the final activated entry
 * set. It never reads a full lorebook or turns dry-run aggregate text into
 * fake entries. The small serial queue prevents two QQ scans from stealing
 * each other's scan-complete event.
 */
export function createQQV2SillyTavernWorldbookContextGateway(options = {}) {
    const getContext = typeof options.getContext === 'function'
        ? options.getContext
        : getFreshSillyTavernContext;
    let pending = Promise.resolve();

    const run = async ({ people = [], history = [] } = {}) => {
        const context = resolveContext(getContext);
        const eventName = context.eventTypes?.WORLDINFO_SCAN_DONE || 'worldinfo_scan_done';
        const eventSource = context.eventSource;
        let finalEntries = null;
        const capture = (args) => {
            if (args?.state?.next) return;
            finalEntries = entriesOf(args?.activated?.entries)
                .map(normalizeEntry)
                .filter(Boolean);
        };
        eventSource.on(eventName, capture);
        try {
            await context.getWorldInfoPrompt(scanChat(people, history), maxContextOf(context), true);
            return Object.freeze([...(finalEntries || [])].map((entry) => Object.freeze({ ...entry })));
        } finally {
            if (typeof eventSource.removeListener === 'function') {
                eventSource.removeListener(eventName, capture);
            } else {
                eventSource.off(eventName, capture);
            }
        }
    };

    return Object.freeze({
        runDryRun(input = {}) {
            const task = pending.then(() => run(input));
            pending = task.catch(() => {});
            return task;
        },
    });
}

export class QQV2WorldbookContextError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'QQV2WorldbookContextError';
        this.code = code;
    }
}
