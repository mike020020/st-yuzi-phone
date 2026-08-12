import { getFreshSillyTavernContext } from '../../integration/context-bridge.js';
import { resolveHostIdentity } from '../../integration/chat-identity.js';
import { getTableData } from '../../phone-core/data-api.js';
import { resolveStatusBarData } from '../../phone-home/status-bar-data.js';
import { canonicalCharacterChatFile } from './lifecycle.js';

const MAX_TEXT_LENGTH = 1024;

function asText(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function requireText(value, label) {
    const text = asText(value);
    if (!text) {
        throw new QQV2HostError(`${label}不可用，请先进入一个酒馆聊天`);
    }
    return text;
}

function readChatId(context) {
    try {
        if (typeof context?.getCurrentChatId === 'function') {
            const current = asText(context.getCurrentChatId());
            if (current) return current;
        }
    } catch {
        // 宿主读取失败时继续使用公开的当前字段。
    }
    return asText(context?.chatId) || asText(context?.chat_id) || asText(context?.chat_file);
}

function readChatFile(context, chatId) {
    return asText(context?.chatFile) || asText(context?.chat_file) || chatId;
}

function readChatIntegrity(context) {
    return asText(context?.chatMetadata?.integrity)
        || asText(context?.chat_metadata?.integrity);
}

function readScopeFacts(context) {
    if (!context || typeof context !== 'object') {
        throw new QQV2HostError('无法取得当前 SillyTavern 聊天上下文');
    }

    const chatId = requireText(readChatId(context), '聊天 ID');
    const chatFile = requireText(readChatFile(context, chatId), '聊天文件');
    const identity = resolveHostIdentity(context, chatId);
    const hostType = requireText(identity?.hostType, '宿主类型');
    const hostId = requireText(identity?.hostId, '宿主 ID');

    return Object.freeze({
        scopeId: `st:${hostType}:${hostId}:${readChatIntegrity(context) || chatFile}`,
        chatId,
        chatFile,
        hostType,
        hostId,
    });
}

function readUserIdentity(context) {
    return Object.freeze({
        name: asText(context?.name1 ?? context?.userName ?? context?.user_name, 256),
        avatar: asText(context?.user_avatar ?? context?.userAvatar, 1024),
    });
}

function mapStoryMessage(message, index) {
    const isUser = message?.is_user === true || message?.isUser === true;
    const rawContent = message?.mes ?? message?.message ?? message?.content ?? '';
    return Object.freeze({
        // SillyTavern emits the chat-array index for CHARACTER_MESSAGE_RENDERED.
        // Preserve it so the active-cycle gate can validate the exact reply.
        messageId: index,
        sequence: index + 1,
        role: isUser ? 'user' : 'assistant',
        speaker: asText(isUser ? message?.name ?? message?.name1 : message?.name, 256),
        content: String(rawContent ?? ''),
        isSystem: message?.is_system === true || message?.isSystem === true,
        isHidden: message?.is_hidden === true || message?.isHidden === true,
        isSuccessful: message?.isSuccessful !== false && message?.is_successful !== false,
    });
}

function createStoryTimeReader(options = {}) {
    const readTableData = typeof options.getTableData === 'function'
        ? options.getTableData
        : getTableData;
    const readStatusBarData = typeof options.resolveStatusBarData === 'function'
        ? options.resolveStatusBarData
        : resolveStatusBarData;

    return () => {
        try {
            return asText(readStatusBarData(readTableData())?.currentTime, 512);
        } catch {
            return '';
        }
    };
}

/**
 * QQ v2 与 SillyTavern 的唯一宿主事实边界。
 * 所有读取均即时完成，绝不缓存上一段聊天的 context。
 */
export function createQQV2HostAdapter(options = {}) {
    const getContext = typeof options.getContext === 'function'
        ? options.getContext
        : getFreshSillyTavernContext;
    const getStoryTime = typeof options.getStoryTime === 'function'
        ? options.getStoryTime
        : createStoryTimeReader(options);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    const readContext = () => {
        const context = getContext();
        if (!context || typeof context !== 'object') {
            throw new QQV2HostError('无法取得当前 SillyTavern 聊天上下文');
        }
        return context;
    };

    return Object.freeze({
        readScope() {
            return readScopeFacts(readContext());
        },
        readUserIdentity() {
            return readUserIdentity(readContext());
        },
        readStoryTime() {
            return asText(getStoryTime(), 512);
        },
        readStoryMessages() {
            const messages = Array.isArray(readContext().chat) ? readContext().chat : [];
            return Object.freeze(messages.map(mapStoryMessage).filter((message) => !message.isSystem));
        },
        async listCharacterChatFiles(hostId) {
            const normalizedHostId = asText(hostId);
            const unresolved = (reason, details = {}) => Object.freeze({
                status: 'unresolved',
                hostId: normalizedHostId,
                reason,
                ...details,
            });
            if (!normalizedHostId) return unresolved('invalid-host-id');
            if (typeof fetchImpl !== 'function') return unresolved('fetch-unavailable');

            let context;
            try {
                context = readContext();
            } catch {
                return unresolved('host-unavailable');
            }
            if (typeof context.getRequestHeaders !== 'function') {
                return unresolved('request-headers-unavailable');
            }

            let response;
            try {
                response = await fetchImpl('/api/characters/chats', {
                    method: 'POST',
                    headers: await Promise.resolve(context.getRequestHeaders()),
                    body: JSON.stringify({ avatar_url: normalizedHostId, simple: true }),
                });
            } catch {
                return unresolved('request-error');
            }
            if (!response?.ok) {
                return unresolved('request-failed', { httpStatus: Number(response?.status) || 0 });
            }

            let payload;
            try {
                payload = await response.json();
            } catch {
                return unresolved('invalid-response');
            }
            if (!Array.isArray(payload) || payload.some((item) => !canonicalCharacterChatFile(item?.file_name || item?.file_id))) {
                return unresolved('invalid-response');
            }
            const chatFiles = Object.freeze([...new Set(payload.map((item) => (
                canonicalCharacterChatFile(item.file_name || item.file_id)
            )))]);
            return Object.freeze({
                status: 'resolved',
                hostId: normalizedHostId,
                chatFiles,
            });
        },
        readRawContext() {
            return readContext();
        },
    });
}

export class QQV2HostError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QQV2HostError';
        this.code = 'host_unavailable';
    }
}
