const cleanupByPage = new WeakMap();

export function registerRoutePageCleanup(page, cleanup) {
    if (!page || typeof cleanup !== 'function') return () => {};
    let cleanups = cleanupByPage.get(page);
    if (!cleanups) {
        cleanups = new Set();
        cleanupByPage.set(page, cleanups);
    }
    cleanups.add(cleanup);
    return () => cleanups.delete(cleanup);
}

export function disposeRoutePage(page) {
    const cleanups = cleanupByPage.get(page);
    if (!cleanups) return false;
    cleanupByPage.delete(page);
    for (const cleanup of [...cleanups]) {
        try { cleanup(); } catch (error) { console.warn('[玉子手机] route page cleanup 失败', error); }
    }
    cleanups.clear();
    return true;
}

export function removeRoutePage(page) {
    if (!page) return false;
    disposeRoutePage(page);
    page.remove?.();
    return true;
}
