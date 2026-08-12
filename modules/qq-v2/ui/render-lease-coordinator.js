function normalizedKey(value) {
    return String(value ?? '').trim();
}

export function createRenderLeaseCoordinator({ acquire, release } = {}) {
    if (typeof acquire !== 'function' || typeof release !== 'function') {
        throw new TypeError('Render lease coordinator needs acquire and release functions');
    }

    const entries = new Map();
    const sessions = new Set();
    let mountedKeys = new Set();
    let disposed = false;

    const retainedKeys = () => {
        const keys = new Set(mountedKeys);
        sessions.forEach((session) => session.usedKeys.forEach((key) => keys.add(key)));
        return keys;
    };

    const releaseUnused = async () => {
        const retained = retainedKeys();
        const releases = [];
        for (const [key, entry] of entries) {
            if (retained.has(key) || entry.promise) continue;
            entries.delete(key);
            if (entry.value) releases.push(Promise.resolve(release(entry.value)).catch(() => {}));
        }
        await Promise.all(releases);
    };

    const loadEntry = async (key) => {
        let entry = entries.get(key);
        if (entry?.value) return entry.value;
        if (!entry) {
            entry = { value: null, promise: null };
            entries.set(key, entry);
        }
        if (!entry.promise) {
            entry.promise = Promise.resolve(acquire(key)).then((value) => {
                entry.promise = null;
                if (value) entry.value = value;
                else entries.delete(key);
                void releaseUnused();
                return value || null;
            }, (error) => {
                entry.promise = null;
                entries.delete(key);
                throw error;
            });
        }
        return entry.promise;
    };

    const begin = () => {
        if (disposed) throw new Error('Render lease coordinator is disposed');
        const session = {
            usedKeys: new Set(),
            closed: false,
            peek(rawKey) {
                const key = normalizedKey(rawKey);
                if (!key || this.closed) return null;
                this.usedKeys.add(key);
                return entries.get(key)?.value || null;
            },
            async load(rawKey) {
                const key = normalizedKey(rawKey);
                if (!key || this.closed) return null;
                this.usedKeys.add(key);
                return loadEntry(key);
            },
            async commit() {
                if (this.closed) return;
                this.closed = true;
                sessions.delete(this);
                mountedKeys = new Set(this.usedKeys);
                await releaseUnused();
            },
            async abort() {
                if (this.closed) return;
                this.closed = true;
                sessions.delete(this);
                await releaseUnused();
            },
        };
        sessions.add(session);
        return session;
    };

    return Object.freeze({
        begin,
        async dispose() {
            disposed = true;
            sessions.forEach((session) => { session.closed = true; });
            sessions.clear();
            mountedKeys.clear();
            await releaseUnused();
        },
    });
}
