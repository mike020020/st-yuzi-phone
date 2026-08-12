export const DEFAULT_SCROLL_BOTTOM_THRESHOLD = 32;

const noop = () => {};

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function itemsFor(root, getItems) {
    const items = typeof getItems === 'function' ? getItems(root) : root?.children;
    return items ? [...items] : [];
}

function hasStableKey(key) {
    return key !== undefined && key !== null && key !== '';
}

export function isScrollContainerNearBottom(root, threshold = DEFAULT_SCROLL_BOTTOM_THRESHOLD) {
    if (!root) return false;
    const distance = finiteNumber(root.scrollHeight)
        - finiteNumber(root.clientHeight)
        - finiteNumber(root.scrollTop);
    return distance <= Math.max(0, finiteNumber(threshold, DEFAULT_SCROLL_BOTTOM_THRESHOLD));
}

export function captureStableScrollAnchor(root, {
    getItems,
    getKey,
    stickToBottom = true,
    bottomThreshold = DEFAULT_SCROLL_BOTTOM_THRESHOLD,
} = {}) {
    if (!root || typeof root.getBoundingClientRect !== 'function') return null;
    if (stickToBottom && isScrollContainerNearBottom(root, bottomThreshold)) {
        return Object.freeze({ mode: 'bottom' });
    }
    if (typeof getKey !== 'function') return null;

    const rootRect = root.getBoundingClientRect();
    for (const item of itemsFor(root, getItems)) {
        const rect = item?.getBoundingClientRect?.();
        if (!rect || rect.bottom <= rootRect.top || rect.top >= rootRect.bottom) continue;
        const key = getKey(item);
        if (!hasStableKey(key)) continue;
        return Object.freeze({
            mode: 'anchor',
            key,
            viewportOffset: finiteNumber(rect.top) - finiteNumber(rootRect.top),
        });
    }
    return null;
}

export function restoreStableScrollAnchor(root, anchor, { getItems, getKey } = {}) {
    if (!root || !anchor) return false;
    if (anchor.mode === 'bottom') {
        root.scrollTop = Math.max(0, finiteNumber(root.scrollHeight) - finiteNumber(root.clientHeight));
        return true;
    }
    if (anchor.mode !== 'anchor'
        || typeof root.getBoundingClientRect !== 'function'
        || typeof getKey !== 'function') return false;

    const target = itemsFor(root, getItems).find((item) => getKey(item) === anchor.key);
    const targetRect = target?.getBoundingClientRect?.();
    if (!targetRect) return false;

    const rootRect = root.getBoundingClientRect();
    const nextOffset = finiteNumber(targetRect.top) - finiteNumber(rootRect.top);
    root.scrollTop = Math.max(0,
        finiteNumber(root.scrollTop) + nextOffset - finiteNumber(anchor.viewportOffset));
    return true;
}

export function scheduleStableScrollAnchorRestore({
    anchor,
    token,
    isCurrent = () => true,
    getRoot,
    getItems,
    getKey,
    enqueue = queueMicrotask,
} = {}) {
    if (!anchor || typeof isCurrent !== 'function' || typeof getRoot !== 'function' || typeof enqueue !== 'function') {
        return noop;
    }

    let cancelled = false;
    enqueue(() => {
        if (cancelled || !isCurrent(token)) return;
        restoreStableScrollAnchor(getRoot(), anchor, { getItems, getKey });
    });
    return () => { cancelled = true; };
}
