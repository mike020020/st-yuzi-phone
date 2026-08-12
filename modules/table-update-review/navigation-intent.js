let pendingIntent = null;
let sequence = 0;

function normalizeIntent(intent = {}) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null;
    const sheetKey = String(intent.sheetKey || '').trim();
    const attemptId = String(intent.attemptId || '').trim();
    if (!sheetKey || !attemptId) return null;
    const rowIndex = Number(intent.rowIndex);
    return Object.freeze({
        attemptId,
        sheetKey,
        rowId: String(intent.rowId ?? '').trim(),
        rowIndex: Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : -1,
        changeType: String(intent.changeType || '').trim(),
        createdAt: Number.isFinite(Number(intent.createdAt)) ? Number(intent.createdAt) : Date.now(),
    });
}

export function createTableReviewNavigationAttemptId() {
    sequence += 1;
    return `review-${Date.now()}-${sequence}-${Math.random().toString(36).slice(2)}`;
}

export function setPendingTableReviewNavigationIntent(intent = {}) {
    const normalized = normalizeIntent(intent);
    if (!normalized) return false;
    pendingIntent = normalized;
    return true;
}

export function peekPendingTableReviewNavigationIntent() { return pendingIntent ? { ...pendingIntent } : null; }
export function clearPendingTableReviewNavigationIntent() { pendingIntent = null; }
export function clearPendingTableReviewNavigationIntentByAttempt(attemptId) {
    if (pendingIntent?.attemptId === String(attemptId || '').trim()) pendingIntent = null;
}
export function discardPendingTableReviewNavigationIntent(sheetKey, attemptId) {
    const key = String(sheetKey || '').trim();
    const attempt = String(attemptId || '').trim();
    if (pendingIntent?.sheetKey !== key || pendingIntent?.attemptId !== attempt) return false;
    pendingIntent = null;
    return true;
}
export function consumePendingTableReviewNavigationIntent(sheetKey, attemptId) {
    const key = String(sheetKey || '').trim();
    const attempt = String(attemptId || '').trim();
    if (!pendingIntent || pendingIntent.sheetKey !== key || pendingIntent.attemptId !== attempt) return null;
    const intent = pendingIntent;
    pendingIntent = null;
    return { ...intent };
}
