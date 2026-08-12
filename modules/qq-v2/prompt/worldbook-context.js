function asText(value) {
    return String(value ?? '').trim();
}

function asEntries(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.entries)) return value.entries;
    if (value instanceof Map || value instanceof Set) return Array.from(value.values());
    if (value?.entries instanceof Map || value?.entries instanceof Set) return Array.from(value.entries.values());
    return [];
}

function normalizePeople(people) {
    const unique = new Set();
    for (const person of Array.isArray(people) ? people : []) {
        const name = asText(person?.name ?? person);
        if (name) unique.add(name);
    }
    return [...unique];
}

function normalizeHistory(history) {
    return (Array.isArray(history) ? history : []).map((item) => String(item ?? ''));
}

function isQQProjection(entry) {
    return entry?.qqMarker === 'qq-v2'
        || entry?.marker === 'qq-v2'
        || entry?.marker?.qq === true
        || entry?.metadata?.qqV2 === true
        || entry?.metadata?.qqMarker === 'qq-v2'
        || entry?.extensions?.yuziPhoneQQV2?.version === 2
        || entry?.qq?.version === 'v2';
}

function normalizeEntry(entry, source) {
    const raw = entry?.entry && typeof entry.entry === 'object' ? { ...entry, ...entry.entry } : entry;
    if (!raw || typeof raw !== 'object' || isQQProjection(entry) || isQQProjection(raw)) return null;
    const content = String(raw.content ?? raw.text ?? raw.value ?? '');
    const bookName = asText(raw.bookName ?? raw.world ?? raw.worldbookName ?? raw.book?.name ?? raw.worldbook?.name);
    const uid = raw.uid ?? raw.entryUid ?? raw.id ?? '';
    return Object.freeze({
        bookName,
        uid,
        content,
        depth: raw.depth ?? raw.position?.depth ?? null,
        role: raw.role === 0 || raw.position?.role === 0
            ? 'system'
            : asText(raw.role ?? raw.position?.role) || 'system',
        source,
    });
}

function dedupeKey(entry, index) {
    const uid = asText(entry.uid);
    return entry.bookName && uid ? `${entry.bookName}\u0000${uid}` : `unkeyed\u0000${index}`;
}

function renderEntry(entry) {
    const details = [
        `书:${entry.bookName || '未命名'}`,
        `UID:${entry.uid === '' ? '无' : entry.uid}`,
        `深度:${entry.depth ?? '无'}`,
        `角色:${entry.role || '无'}`,
        `来源:${entry.source}`,
    ].join('｜');
    return `[世界书｜${details}]\n${entry.content}`;
}

async function dryRun(runDryRun, request, source) {
    if (typeof runDryRun !== 'function') return [];
    const result = await runDryRun(Object.freeze({
        layer: request.layer,
        people: Object.freeze([...request.people]),
        history: Object.freeze([...request.history]),
    }));
    return asEntries(result).map((entry) => normalizeEntry(entry, source)).filter(Boolean);
}

/**
 * QQ 世界书上下文只合并当前剧情层与当前人物层。调用方提供的 dry-run 是唯一宿主 seam，
 * 这层不读取全量世界书，也不创建或修改条目。
 */
export async function resolveQQV2WorldbookContext({
    activationSnapshot,
    people = [],
    visibleHistory = [],
    runDryRun,
} = {}) {
    const normalizedPeople = normalizePeople(people);
    const normalizedHistory = normalizeHistory(visibleHistory);
    const requestFacts = { people: normalizedPeople, history: normalizedHistory };
    const hasSnapshot = activationSnapshot !== undefined && activationSnapshot !== null;
    const storyEntries = hasSnapshot
        ? asEntries(activationSnapshot)
            .map((entry) => normalizeEntry(entry, 'activation-snapshot'))
            .filter(Boolean)
        : await dryRun(runDryRun, { layer: 'story', ...requestFacts }, 'story-dry-run');
    const personEntries = await dryRun(runDryRun, { layer: 'person', ...requestFacts }, 'person-dry-run');
    const entries = [];
    const seen = new Set();
    for (const entry of [...storyEntries, ...personEntries]) {
        const key = dedupeKey(entry, entries.length);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
    }
    return Object.freeze({
        entries: Object.freeze(entries),
        text: entries.map(renderEntry).join('\n\n') || '无',
    });
}
