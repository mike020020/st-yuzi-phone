const HOST_TYPES = new Set(['character', 'group', 'chat']);

function asText(value, maxLength = 1024) {
    return String(value ?? '').trim().slice(0, maxLength);
}

export function canonicalCharacterChatFile(value) {
    return asText(value).replace(/\.jsonl$/i, '');
}

export function normalizeQQV2HostMetadata(value) {
    const scopeId = asText(value?.scopeId);
    const hostType = asText(value?.hostType, 32);
    const hostId = asText(value?.hostId);
    const chatId = asText(value?.chatId);
    const chatFile = asText(value?.chatFile);
    if (!scopeId || !HOST_TYPES.has(hostType) || !hostId || !chatId || !chatFile) return null;

    return Object.freeze({ scopeId, hostType, hostId, chatId, chatFile });
}

export function createHostChatChangedFact({ chatId = '', previousScope = null, currentScope = null } = {}) {
    const previous = normalizeQQV2HostMetadata(previousScope);
    const current = normalizeQQV2HostMetadata(currentScope);
    const changed = previous?.scopeId !== current?.scopeId;

    return Object.freeze({
        kind: 'chat-changed',
        chatId: asText(chatId) || current?.chatId || '',
        previousScope: previous,
        currentScope: current,
        currentScopeId: current?.scopeId || '',
        leftScopeId: changed ? previous?.scopeId || '' : '',
        enteredScopeId: changed ? current?.scopeId || '' : '',
        changed,
    });
}

export function createHostChatDeletedFact(kind, deletedChatId, options = {}) {
    const hostType = kind === 'group' ? 'group' : kind === 'character' ? 'character' : '';
    const normalizedId = hostType === 'character'
        ? canonicalCharacterChatFile(deletedChatId)
        : asText(deletedChatId);

    return Object.freeze({
        kind: hostType ? `${hostType}-chat-deleted` : 'invalid-chat-deleted',
        hostType,
        hostId: asText(options.hostId),
        deletedChatId: normalizedId,
        valid: !!hostType && !!normalizedId,
    });
}

export function resolveDeletedQQV2Scope(fact, hostMetadata = []) {
    if (!fact?.valid) {
        return Object.freeze({
            status: 'invalid',
            reason: 'invalid-deletion-fact',
            fact,
            candidates: Object.freeze([]),
            candidateScopeIds: Object.freeze([]),
            preferredCandidateScopeIds: Object.freeze([]),
        });
    }

    const normalizedByScopeId = new Map(hostMetadata
        .map(normalizeQQV2HostMetadata)
        .filter(Boolean)
        .map((candidate) => [candidate.scopeId, candidate]));
    const filenameCandidates = [...normalizedByScopeId.values()]
        .filter((candidate) => {
            if (candidate.hostType !== fact.hostType) return false;
            if (fact.hostType === 'group') return candidate.chatId === fact.deletedChatId;
            return canonicalCharacterChatFile(candidate.chatFile) === fact.deletedChatId;
        });
    const exactHostCandidates = fact.hostId
        ? filenameCandidates.filter((candidate) => candidate.hostId === fact.hostId)
        : [];
    const frozenCandidates = Object.freeze([...filenameCandidates]);
    const candidateScopeIds = Object.freeze(filenameCandidates.map((candidate) => candidate.scopeId));
    const preferredCandidateScopeIds = Object.freeze(exactHostCandidates.map((candidate) => candidate.scopeId));
    const diagnostics = {
        fact,
        hostType: fact.hostType,
        hostId: fact.hostId,
        deletedChatId: fact.deletedChatId,
        candidates: frozenCandidates,
        candidateScopeIds,
        preferredCandidateScopeIds,
    };

    if (filenameCandidates.length === 1) {
        return Object.freeze({
            status: 'matched',
            scope: filenameCandidates[0],
            match: exactHostCandidates.length === 1 ? 'exact-host' : 'unique-filename',
            ...diagnostics,
        });
    }

    return Object.freeze({
        status: filenameCandidates.length > 1 ? 'ambiguous' : 'not-found',
        reason: filenameCandidates.length > 1 ? 'multiple-filename-matches' : 'no-filename-match',
        ...diagnostics,
    });
}
