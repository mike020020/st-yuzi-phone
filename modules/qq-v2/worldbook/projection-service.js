import { formatQQV2MessageSemantic } from '../domain/message-semantics.js';
import { qqV2WorldbookPlacement } from './placement.js';

const MARKER_KEY = 'yuziPhoneQQV2';
const SELF_ID = '__self__';

function asText(value, maxLength = 0) {
    const text = String(value ?? '').trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function clone(value) {
    if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function uniqueNames(values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
        const name = asText(value, 256);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    return result;
}

function parseStoryTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(asText(value, 128));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

function dateLabel(value) {
    const date = parseStoryTime(value);
    if (!date) return '未知故事时间';
    const two = (number) => String(number).padStart(2, '0');
    return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

function subtractStoryWindow(now, window) {
    const date = new Date(now.getTime());
    const amount = Number(window?.value);
    if (!Number.isInteger(amount) || amount <= 0) return null;
    switch (window?.unit) {
    case 'hour':
        date.setUTCHours(date.getUTCHours() - amount);
        return date;
    case 'day':
        date.setUTCDate(date.getUTCDate() - amount);
        return date;
    case 'month': {
        const day = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() - amount);
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
        date.setUTCDate(Math.min(day, lastDay));
        return date;
    }
    case 'year': {
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCFullYear(date.getUTCFullYear() - amount, month, 1);
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
        date.setUTCDate(Math.min(day, lastDay));
        return date;
    }
    default:
        return null;
    }
}

function inAutomaticWindow(message, settings, storyTime) {
    if (settings.timeWindow?.mode === 'all') return true;
    const now = parseStoryTime(storyTime);
    const messageTime = parseStoryTime(message.storyTime);
    if (!now || !messageTime) return false;
    const cutoff = subtractStoryWindow(now, settings.timeWindow);
    return Boolean(cutoff && messageTime >= cutoff && messageTime <= now);
}

function isInjectableMessage(message) {
    if (!asText(message?.messageId, 256)) return false;
    if (message.isTimeSeparator === true || message.kind === 'time-separator' || message.type === 'time-separator') return false;
    if (message.senderType === 'system' || message.senderId === '__system__' || message.type === 'system') {
        return message.deletable !== false;
    }
    return message.senderId === SELF_ID
        || message.senderType === 'self'
        || message.senderType === 'person';
}

function selectProjectionMessages(data, storyTime) {
    const selectedIds = new Set(data.conversation.injection.selectedMessageIds || []);
    const messages = new Map();
    for (const message of data.messages || []) {
        if (!isInjectableMessage(message)) continue;
        if (message.selectedForInjection !== true
            && !selectedIds.has(message.messageId)
            && !inAutomaticWindow(message, data.settings, storyTime)) continue;
        if (!messages.has(message.messageId)) messages.set(message.messageId, message);
    }
    return [...messages.values()].sort((left, right) => {
        const sequenceDifference = Number(left.sequence || 0) - Number(right.sequence || 0);
        if (sequenceDifference) return sequenceDifference;
        return (parseStoryTime(left.storyTime)?.getTime() || 0) - (parseStoryTime(right.storyTime)?.getTime() || 0);
    });
}

function dedupeKeywords(values) {
    const seen = new Set();
    return values.map((item) => asText(item, 160)).filter((item) => {
        const key = item.toLocaleLowerCase('zh-CN');
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function markerFor(scopeId, conversationId) {
    return { version: 2, scopeId, conversationId };
}

function isOwnedEntry(entry, scopeId, conversationId = '') {
    const marker = entry?.extensions?.[MARKER_KEY];
    return marker?.version === 2
        && marker.scopeId === scopeId
        && (!conversationId || marker.conversationId === conversationId);
}

function ensureEntries(book) {
    if (!isObject(book.entries)) book.entries = {};
    return book.entries;
}

function nextUid(entries) {
    const ids = Object.keys(entries)
        .map((key) => Number(entries[key]?.uid ?? key))
        .filter((value) => Number.isInteger(value) && value >= 0);
    return ids.length ? Math.max(...ids) + 1 : 0;
}

function ownedEntries(book, scopeId, conversationId = '') {
    return Object.entries(ensureEntries(book)).filter(([, entry]) => isOwnedEntry(entry, scopeId, conversationId));
}

function removeOwnedEntries(book, scopeId, conversationId = '') {
    const entries = ensureEntries(book);
    let removed = false;
    for (const [key, entry] of Object.entries(entries)) {
        if (!isOwnedEntry(entry, scopeId, conversationId)) continue;
        delete entries[key];
        removed = true;
    }
    return removed;
}

function ownedEntriesForConversations(book, scopeId, conversationIds) {
    const ids = conversationIds instanceof Set ? conversationIds : new Set(conversationIds);
    return Object.entries(ensureEntries(book)).filter(([, entry]) => {
        const marker = entry?.extensions?.[MARKER_KEY];
        return marker?.version === 2 && marker.scopeId === scopeId && ids.has(marker.conversationId);
    });
}

function removeEntriesForConversations(book, scopeId, conversationIds) {
    const entries = ensureEntries(book);
    let removed = false;
    for (const [key] of ownedEntriesForConversations(book, scopeId, conversationIds)) {
        delete entries[key];
        removed = true;
    }
    return removed;
}

function restoreOwnedEntries(book, scopeId, snapshot, conversationId = '') {
    removeOwnedEntries(book, scopeId, conversationId);
    const entries = ensureEntries(book);
    for (const [key, entry] of snapshot) {
        if (entries[key] && !isOwnedEntry(entries[key], scopeId, conversationId)) {
            throw new Error(`QQ 世界书条目 ${key} 已被占用`);
        }
        entries[key] = clone(entry);
    }
}

function restoreConversationEntries(book, scopeId, conversationIds, snapshot) {
    const ids = conversationIds instanceof Set ? conversationIds : new Set(conversationIds);
    removeEntriesForConversations(book, scopeId, ids);
    const entries = ensureEntries(book);
    for (const [key, entry] of snapshot) {
        const marker = entries[key]?.extensions?.[MARKER_KEY];
        const replaceable = marker?.version === 2
            && marker.scopeId === scopeId
            && ids.has(marker.conversationId);
        if (entries[key] && !replaceable) {
            throw new Error(`QQ 世界书条目 ${key} 已被占用`);
        }
        entries[key] = clone(entry);
    }
}

function trackedBookNames(data) {
    const projection = data?.conversation?.injection?.projection || {};
    return uniqueNames([
        data?.settings?.bookName,
        projection.bookName,
        ...(projection.pending === true && Array.isArray(projection.managedBookNames)
            ? projection.managedBookNames
            : []),
    ]);
}

function resolveParticipantNames(data) {
    const people = new Map((data.people || []).map((person) => [person.personId, person.formalName]));
    if (data.conversation.kind === 'private') {
        return [asText(people.get(data.conversation.personId))].filter(Boolean);
    }
    return (data.group?.memberIds || []).map((personId) => asText(people.get(personId))).filter(Boolean);
}

function resolveEntryName(data) {
    if (data.conversation.kind === 'private') return resolveParticipantNames(data)[0] || '未命名人物';
    return asText(data.group?.name) || '未命名群聊';
}

function conversationTitle(data) {
    return data.conversation.kind === 'private'
        ? `QQ｜私聊｜${resolveEntryName(data)}`
        : `QQ｜群聊｜${resolveEntryName(data)}`;
}

function senderName(message, people, userName) {
    if (message.senderType === 'system' || message.senderId === '__system__') return '系统';
    if (message.senderId === SELF_ID || message.senderType === 'self') return userName || '用户';
    return asText(message.senderName) || asText(people.get(message.senderId)) || '未知成员';
}

function buildProjectionContent(data, userName, storyTime) {
    const people = new Map((data.people || []).map((person) => [person.personId, person.formalName]));
    const participants = resolveParticipantNames(data);
    const header = data.conversation.kind === 'private'
        ? [`【QQ 私聊：${resolveEntryName(data)}】`, `参与者：${[userName || '用户', ...participants].filter(Boolean).join('、')}`]
        : [`【QQ群聊：${resolveEntryName(data)}】`, `当前成员：${participants.join('、') || '无'}`];
    const messages = selectProjectionMessages(data, storyTime);
    if (!messages.length) return { content: '', hasMessages: false };
    let lastDate = '';
    const lines = [...header, ''];
    for (const message of messages) {
        const date = dateLabel(message.storyTime);
        if (date !== lastDate) {
            lines.push(`[${date}]`);
            lastDate = date;
        }
        const deletedQuote = data.conversation?.kind === 'group'
            && message.quoteMessageId
            && !(data.messages || []).some((candidate) => candidate.messageId === message.quoteMessageId);
        const suffix = deletedQuote ? '（引用原消息已删除）' : '';
        lines.push(`${senderName(message, people, userName)}：${formatQQV2MessageSemantic(message, {
            selfName: userName,
            resolvePersonName: (personId) => people.get(personId),
        })}${suffix}`);
    }
    return { content: lines.join('\n'), hasMessages: true };
}

function effectiveInjection(data) {
    const global = data.settings;
    const local = data.conversation.injection;
    const hasExplicitOverrides = Object.hasOwn(local, 'useConversationLight') || Object.hasOwn(local, 'useConversationDepth');
    const useConversationLight = local.useConversationLight === true || (!hasExplicitOverrides && local.followGlobal === false);
    const useConversationDepth = local.useConversationDepth === true || (!hasExplicitOverrides && local.followGlobal === false);
    const light = useConversationLight ? local.light : global.light;
    const depth = useConversationDepth ? local.depth : global.depth;
    const personKeywords = light === 'green' ? resolveParticipantNames(data) : [];
    return {
        light,
        depth,
        keywords: light === 'green'
            ? dedupeKeywords([...personKeywords, ...(global.keywords || []), ...(local.keywords || [])])
            : [],
    };
}

function writeEntry(book, data, content, scopeId) {
    const entries = ensureEntries(book);
    const owned = ownedEntries(book, scopeId, data.conversation.conversationId);
    const [first] = owned;
    for (const [key] of owned.slice(1)) delete entries[key];
    const preferredUid = data.conversation.injection.projection.entryUid;
    const existing = first?.[1]
        || (preferredUid !== null && entries[preferredUid] && isOwnedEntry(entries[preferredUid], scopeId, data.conversation.conversationId)
            ? entries[preferredUid]
            : null);
    const preferredEntry = preferredUid !== null ? entries[String(preferredUid)] : null;
    const uid = existing?.uid
        ?? (preferredUid !== null && !preferredEntry ? preferredUid : nextUid(entries));
    const key = String(uid);
    const injection = effectiveInjection(data);
    const entry = {
        ...(existing ? clone(existing) : {}),
        uid,
        key: injection.keywords,
        keysecondary: [],
        comment: conversationTitle(data),
        content,
        constant: injection.light === 'blue',
        selective: false,
        addMemo: true,
        disable: false,
        ...qqV2WorldbookPlacement(injection.depth),
        extensions: {
            ...(existing?.extensions || {}),
            [MARKER_KEY]: markerFor(scopeId, data.conversation.conversationId),
        },
    };
    entries[key] = entry;
    if (existing && String(existing.uid) !== key) delete entries[String(existing.uid)];
    return entry;
}

function targetError(message) {
    const error = new Error(message);
    error.code = 'worldbook_target_invalid';
    return error;
}

function disabledError() {
    const error = new Error('请先开启 QQ 世界书总闸和当前会话注入');
    error.code = 'worldbook_injection_disabled';
    return error;
}

/** QQ 消息到世界书条目的唯一投影模块。只处理调用方传入的作用域和明确记录过的目标书。 */
export function createQQV2WorldbookProjectionService(options = {}) {
    const repository = options.repository;
    const worldbookGateway = options.worldbookGateway;
    if (!repository || typeof repository.getWorldbookProjectionData !== 'function') {
        throw new TypeError('QQ v2 worldbook projection service 需要 repository');
    }
    if (typeof repository.clearAllSelectedMessagesForInjection !== 'function'
        || typeof repository.clearSelectedMessagesForInjection !== 'function'
        || typeof repository.setMessagesSelectedForInjection !== 'function') {
        throw new TypeError('QQ v2 worldbook projection service 需要批量手选消息仓储接口');
    }
    if (!worldbookGateway || typeof worldbookGateway.loadBook !== 'function' || typeof worldbookGateway.saveBook !== 'function') {
        throw new TypeError('QQ v2 worldbook projection service 需要 worldbookGateway');
    }

    const worldbookSettings = options.worldbookSettings || {
        get: typeof repository.getWorldbookSettings === 'function'
            ? (scopeId) => repository.getWorldbookSettings(scopeId)
            : null,
        update: typeof repository.updateWorldbookSettings === 'function'
            ? (scopeId, patch) => repository.updateWorldbookSettings(scopeId, patch)
            : null,
    };
    if (options.worldbookSettings
        && (typeof worldbookSettings.get !== 'function' || typeof worldbookSettings.update !== 'function')) {
        throw new TypeError('QQ v2 worldbook projection service 需要有效的 worldbookSettings');
    }

    const getProjectionData = async (scopeId, conversationId) => {
        const data = await repository.getWorldbookProjectionData(scopeId, conversationId);
        if (typeof worldbookSettings.get !== 'function') return data;
        return { ...data, settings: clone(await worldbookSettings.get(scopeId)) };
    };

    const loadBook = async (name, scopeId, allowInactiveScope = false) => {
        const bookName = asText(name, 256);
        if (!bookName) throw targetError('请先选择 QQ 目标世界书');
        const book = await worldbookGateway.loadBook(bookName, scopeId, { allowInactiveScope });
        if (!book) throw targetError(`QQ 世界书 ${bookName} 不存在`);
        return clone(book);
    };

    const loadOptionalBook = async (name, scopeId, allowInactiveScope = false) => {
        const bookName = asText(name, 256);
        if (!bookName) return null;
        const book = await worldbookGateway.loadBook(bookName, scopeId, { allowInactiveScope });
        return book ? clone(book) : null;
    };

    const saveBook = (name, book, scopeId, allowInactiveScope = false) => (
        worldbookGateway.saveBook(name, book, scopeId, { allowInactiveScope })
    );

    const privateConversations = async (scopeId) => (
        (await repository.listConversations(scopeId)).filter((conversation) => conversation.kind === 'private')
    );

    const setPending = async (scopeId, conversationId, names = []) => repository.setConversationProjection(
        scopeId,
        conversationId,
        { managedBookNames: uniqueNames(names), pending: true },
    );

    const restoreBook = async ({
        name,
        entries,
        scopeId,
        conversationId = '',
        conversationIds = null,
        allowInactiveScope = false,
    }) => {
        const current = await loadBook(name, scopeId, allowInactiveScope);
        if (conversationIds) restoreConversationEntries(current, scopeId, conversationIds, entries);
        else restoreOwnedEntries(current, scopeId, entries, conversationId);
        await saveBook(name, current, scopeId, allowInactiveScope);
    };

    const removeProjection = async (scopeId, conversationId, data, {
        clearSelected = false,
        allowInactiveScope = false,
    } = {}) => {
        if (clearSelected) await repository.clearSelectedMessagesForInjection(scopeId, conversationId);
        const names = trackedBookNames(data);
        const snapshots = [];
        try {
            for (const name of names) {
                const book = await loadOptionalBook(name, scopeId, allowInactiveScope);
                if (!book) continue;
                const entries = ownedEntries(book, scopeId, conversationId).map(([key, entry]) => [key, clone(entry)]);
                if (removeOwnedEntries(book, scopeId, conversationId)) {
                    snapshots.push({ name, entries });
                    await saveBook(name, book, scopeId, allowInactiveScope);
                }
            }
            const previousProjection = clone(data.conversation.injection.projection);
            await repository.setConversationProjection(scopeId, conversationId, {
                bookName: '', entryUid: null, managedBookNames: [], pending: false,
            });
            return {
                status: 'removed',
                rollback: async () => {
                    try {
                        for (const snapshot of snapshots) {
                            await restoreBook({ ...snapshot, scopeId, conversationId, allowInactiveScope });
                        }
                        await repository.setConversationProjection(scopeId, conversationId, previousProjection);
                        return { status: 'restored' };
                    } catch {
                        await setPending(scopeId, conversationId, names).catch(() => {});
                        return { status: 'pending' };
                    }
                },
            };
        } catch {
            await setPending(scopeId, conversationId, names).catch(() => {});
            return { status: 'pending' };
        }
    };

    const syncConversation = async ({ scopeId, conversationId, userName = '', storyTime = '' } = {}) => {
        const data = await getProjectionData(scopeId, conversationId);
        if (!data.settings.enabled || !data.conversation.injection.enabled) {
            return removeProjection(scopeId, conversationId, data);
        }
        const targetName = asText(data.settings.bookName, 256);
        const names = trackedBookNames(data);
        try {
            const target = await loadBook(targetName, scopeId);
            const projection = buildProjectionContent(data, asText(userName, 256), storyTime);
            let entry = null;
            if (projection.hasMessages) entry = writeEntry(target, data, projection.content, scopeId);
            else removeOwnedEntries(target, scopeId, conversationId);
            await saveBook(targetName, target, scopeId);

            for (const name of names.filter((item) => item !== targetName)) {
                const staleBook = await loadOptionalBook(name, scopeId);
                if (!staleBook) continue;
                if (removeOwnedEntries(staleBook, scopeId, conversationId)) {
                    await saveBook(name, staleBook, scopeId);
                }
            }
            await repository.setConversationProjection(scopeId, conversationId, {
                bookName: entry ? targetName : '',
                entryUid: entry?.uid ?? null,
                managedBookNames: entry ? [targetName] : [],
                pending: false,
            });
            return entry ? { status: 'synced', entryUid: entry.uid } : { status: 'empty' };
        } catch (error) {
            if (error?.code === 'worldbook_target_invalid') throw error;
            await setPending(scopeId, conversationId, uniqueNames([...names, targetName])).catch(() => {});
            return { status: 'pending' };
        }
    };

    const reconcileScope = async ({ scopeId, userName = '', storyTime = '' } = {}) => {
        const conversations = await privateConversations(scopeId);
        const results = [];
        for (const conversation of conversations) {
            results.push(await syncConversation({ scopeId, conversationId: conversation.conversationId, userName, storyTime }));
        }
        return results;
    };

    const removeScopeProjections = async ({ scopeId, allowInactiveScope = true } = {}) => {
        const conversations = await privateConversations(scopeId);
        const conversationIds = new Set(conversations.map((conversation) => conversation.conversationId));
        const dataList = [];
        for (const conversation of conversations) {
            dataList.push(await getProjectionData(scopeId, conversation.conversationId));
        }
        const settings = await worldbookSettings.get(scopeId);
        const names = uniqueNames([settings.bookName, ...dataList.flatMap(trackedBookNames)]);
        const snapshots = [];
        try {
            for (const name of names) {
                const book = await loadOptionalBook(name, scopeId, allowInactiveScope);
                if (!book) continue;
                const entries = ownedEntriesForConversations(book, scopeId, conversationIds)
                    .map(([key, entry]) => [key, clone(entry)]);
                if (removeEntriesForConversations(book, scopeId, conversationIds)) {
                    snapshots.push({ name, entries });
                    await saveBook(name, book, scopeId, allowInactiveScope);
                }
            }
            const previous = new Map(dataList.map((data) => [
                data.conversation.conversationId,
                clone(data.conversation.injection.projection),
            ]));
            for (const conversation of conversations) {
                await repository.setConversationProjection(scopeId, conversation.conversationId, {
                    bookName: '', entryUid: null, managedBookNames: [], pending: false,
                });
            }
            return {
                status: 'removed',
                rollback: async () => {
                    try {
                        for (const snapshot of snapshots) {
                            await restoreBook({ ...snapshot, scopeId, conversationIds, allowInactiveScope });
                        }
                        for (const [conversationId, projection] of previous) {
                            await repository.setConversationProjection(scopeId, conversationId, projection);
                        }
                        return { status: 'restored' };
                    } catch {
                        for (const conversation of conversations) {
                            await setPending(scopeId, conversation.conversationId, names).catch(() => {});
                        }
                        return { status: 'pending' };
                    }
                },
            };
        } catch {
            for (const conversation of conversations) {
                await setPending(scopeId, conversation.conversationId, names).catch(() => {});
            }
            return { status: 'pending' };
        }
    };

    const migrateTarget = async ({ scopeId, current, next, userName, storyTime }) => {
        const oldName = asText(current.bookName, 256);
        const newName = asText(next.bookName, 256);
        const conversations = await privateConversations(scopeId);
        const conversationIds = new Set(conversations.map((conversation) => conversation.conversationId));
        const dataList = [];
        for (const conversation of conversations) {
            dataList.push(await getProjectionData(scopeId, conversation.conversationId));
        }
        const oldBook = await loadBook(oldName, scopeId);
        const newBook = await loadBook(newName, scopeId);
        const oldSnapshot = ownedEntriesForConversations(oldBook, scopeId, conversationIds)
            .map(([key, entry]) => [key, clone(entry)]);
        const newSnapshot = ownedEntriesForConversations(newBook, scopeId, conversationIds)
            .map(([key, entry]) => [key, clone(entry)]);
        const previousProjections = new Map(dataList.map((data) => [
            data.conversation.conversationId,
            clone(data.conversation.injection.projection),
        ]));
        const states = new Map();
        removeEntriesForConversations(newBook, scopeId, conversationIds);
        for (const data of dataList) {
            data.settings = clone(next);
            if (!data.conversation.injection.enabled) {
                states.set(data.conversation.conversationId, { bookName: '', entryUid: null });
                continue;
            }
            const projection = buildProjectionContent(data, asText(userName, 256), storyTime);
            const entry = projection.hasMessages ? writeEntry(newBook, data, projection.content, scopeId) : null;
            states.set(data.conversation.conversationId, {
                bookName: entry ? newName : '',
                entryUid: entry?.uid ?? null,
            });
        }

        let newWriteStarted = false;
        let oldWriteStarted = false;
        let settingsWriteStarted = false;
        try {
            newWriteStarted = true;
            await saveBook(newName, newBook, scopeId);
            if (removeEntriesForConversations(oldBook, scopeId, conversationIds)) {
                oldWriteStarted = true;
                await saveBook(oldName, oldBook, scopeId);
            }
            settingsWriteStarted = true;
            await worldbookSettings.update(scopeId, next);
            for (const conversation of conversations) {
                const state = states.get(conversation.conversationId) || { bookName: '', entryUid: null };
                await repository.setConversationProjection(scopeId, conversation.conversationId, {
                    ...state,
                    managedBookNames: state.bookName ? [newName] : [],
                    pending: false,
                });
            }
            return { status: 'migrated' };
        } catch (error) {
            let rollbackPending = false;
            if (oldWriteStarted) {
                await restoreBook({
                    name: oldName, entries: oldSnapshot, scopeId, conversationIds,
                }).catch(() => { rollbackPending = true; });
            }
            if (newWriteStarted) {
                await restoreBook({
                    name: newName, entries: newSnapshot, scopeId, conversationIds,
                }).catch(() => { rollbackPending = true; });
            }
            if (settingsWriteStarted) {
                await worldbookSettings.update(scopeId, current).catch(() => { rollbackPending = true; });
            }
            for (const [conversationId, projection] of previousProjections) {
                await repository.setConversationProjection(scopeId, conversationId, projection).catch(() => { rollbackPending = true; });
            }
            if (rollbackPending) {
                for (const conversation of conversations) {
                    await setPending(scopeId, conversation.conversationId, [oldName, newName]).catch(() => {});
                }
            }
            error.rollbackPending = rollbackPending;
            throw error;
        }
    };

    const setMessagesSelected = async ({
        scopeId,
        conversationId,
        messageIds = [],
        selected,
        userName = '',
        storyTime = '',
    } = {}) => {
        const global = await worldbookSettings.get(scopeId);
        const conversation = await repository.getConversation(scopeId, conversationId);
        if (!global.enabled || !conversation?.injection?.enabled) throw disabledError();
        const ids = [...new Set(messageIds.map((id) => asText(id, 256)).filter(Boolean))];
        await repository.setMessagesSelectedForInjection(scopeId, conversationId, ids, selected);
        return syncConversation({ scopeId, conversationId, userName, storyTime });
    };

    return Object.freeze({
        async setGlobalSettings({ scopeId, settings = {}, userName = '', storyTime = '' } = {}) {
            const current = await worldbookSettings.get(scopeId);
            const next = { ...current, ...settings };
            if (settings.timeWindow) next.timeWindow = settings.timeWindow;
            if (next.enabled) await loadBook(next.bookName, scopeId);
            const changingTarget = current.enabled
                && next.enabled
                && current.bookName
                && next.bookName
                && current.bookName !== next.bookName;
            if (changingTarget) return migrateTarget({ scopeId, current, next, userName, storyTime });

            const saved = await worldbookSettings.update(scopeId, settings);
            if (!saved.enabled) {
                await repository.clearAllSelectedMessagesForInjection();
                const result = await removeScopeProjections({ scopeId, allowInactiveScope: false });
                return { ...result, status: result.status === 'removed' ? 'disabled' : result.status };
            }
            const results = await reconcileScope({ scopeId, userName, storyTime });
            return { status: results.some((result) => result.status === 'pending') ? 'pending' : 'saved', results };
        },
        async setConversationInjection({ scopeId, conversationId, injection = {}, userName = '', storyTime = '' } = {}) {
            const global = await worldbookSettings.get(scopeId);
            const current = await repository.getConversation(scopeId, conversationId);
            const nextEnabled = Object.hasOwn(injection, 'enabled') ? injection.enabled === true : current?.injection?.enabled === true;
            if (global.enabled && nextEnabled) await loadBook(global.bookName, scopeId);
            await repository.updateConversationInjection(scopeId, conversationId, injection);
            if (!nextEnabled) await repository.clearSelectedMessagesForInjection(scopeId, conversationId);
            return syncConversation({ scopeId, conversationId, userName, storyTime });
        },
        async setMessageSelected({ scopeId, conversationId, messageId, selected, userName = '', storyTime = '' } = {}) {
            return setMessagesSelected({
                scopeId, conversationId, messageIds: [messageId], selected, userName, storyTime,
            });
        },
        setMessagesSelected,
        syncConversation,
        reconcileScope,
        removeScopeProjections,
        async removeConversationProjection({ scopeId, conversationId } = {}) {
            const data = await getProjectionData(scopeId, conversationId);
            return removeProjection(scopeId, conversationId, data, { allowInactiveScope: true });
        },
        async retryPending({ scopeId, userName = '', storyTime = '' } = {}) {
            const conversations = await privateConversations(scopeId);
            const results = [];
            for (const conversation of conversations) {
                if (!conversation.injection?.projection?.pending) continue;
                results.push(await syncConversation({ scopeId, conversationId: conversation.conversationId, userName, storyTime }));
            }
            return results;
        },
    });
}

export const QQ_V2_WORLDBOOK_MARKER_KEY = MARKER_KEY;
