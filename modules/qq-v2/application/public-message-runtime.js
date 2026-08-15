import { PublicApiErrorCodes } from '../../public-api/errors.js';

function unavailable() {
    const error = new Error('QQ 消息运行时不可用');
    error.name = 'YuziPhonePublicApiError';
    error.code = PublicApiErrorCodes.API_UNAVAILABLE;
    return error;
}

function publicError(message, code, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhonePublicApiError';
    error.code = code;
    error.details = details;
    return error;
}

function requiredText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw publicError(`${label}不能为空`, PublicApiErrorCodes.INVALID_ARGUMENT);
    return text;
}

function normalizeReadRequest(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw publicError('消息读取请求必须是对象', PublicApiErrorCodes.INVALID_ARGUMENT);
    }
    return {
        scopeId: requiredText(payload.scopeId, 'scopeId'),
        conversationId: requiredText(payload.conversationId, 'conversationId'),
    };
}

function normalizeLimit(value) {
    if (value === undefined || value === null || value === '') return 40;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw publicError('limit 必须是正数', PublicApiErrorCodes.INVALID_ARGUMENT);
    }
    return Math.min(100, Math.max(1, Math.trunc(numeric)));
}

function normalizeReadError(error) {
    if (error?.code === 'conversation_not_found') {
        return publicError('目标会话不存在', PublicApiErrorCodes.MESSAGE_CONVERSATION_NOT_FOUND, {
            causeCode: error.code,
        });
    }
    if (error?.code === 'scope_not_found') {
        return publicError('请求 scope 不存在', PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH, {
            causeCode: error.code,
        });
    }
    if (error?.code === 'message_not_found') {
        return publicError('beforeMessageId 不属于目标会话', PublicApiErrorCodes.INVALID_ARGUMENT, {
            causeCode: error.code,
        });
    }
    return error;
}

function validatePayload(payload = {}, multiple = false) {
    const scopeId = String(payload.scopeId || '').trim();
    const conversationId = String(payload.conversationId || '').trim();
    const messages = multiple ? payload.messages : [payload.message || payload];
    if (!scopeId || !conversationId || !Array.isArray(messages) || messages.length === 0) {
        const error = new Error('scopeId、conversationId 和消息内容不能为空');
        error.name = 'YuziPhonePublicApiError';
        error.code = PublicApiErrorCodes.INVALID_ARGUMENT;
        throw error;
    }
    // 底层运行时使用 externalKey 保证导入可安全重试；公开边界拒绝含糊消息，绝不
    // 擅自生成键。
    for (const message of messages) {
        if (!String(message?.externalKey || '').trim()) {
            const error = new Error('每条消息都必须提供外部幂等键');
            error.name = 'YuziPhonePublicApiError';
            error.code = PublicApiErrorCodes.INVALID_ARGUMENT;
            throw error;
        }
    }
    return { scopeId, conversationId, messages };
}

/**
 * 创建面向 QQ V2 的消息公开适配器。运行时按调用时延迟解析，避免缓存已销毁实例。
 * 每条消息必须有 externalKey；幂等性由底层以 scopeId+conversationId+externalKey 作用域保证。
 * @param {{getRuntime?: () => object|null, scopeId?: string}} [options]
 * @returns {Readonly<object>} 冻结的受控公开消息接口。
 */
export function createQQV2PublicMessageRuntime({ getRuntime, scopeId = '' } = {}) {
    // The scope is intentionally captured once. A caller holding this facade through a
    // SillyTavern chat switch cannot turn it into a reader for the newly active chat.
    let lockedScopeId = String(scopeId ?? '').trim()
        || String(getRuntime?.()?.getActiveScopeId?.() ?? '').trim();
    const resolve = () => {
        // 延迟解析：QQ 运行时在扩展启动后创建并于销毁时释放，绝不缓存过期实例。
        const runtime = getRuntime?.();
        if (!runtime || typeof runtime.append !== 'function' || typeof runtime.importHistory !== 'function') throw unavailable();
        return runtime;
    };
    const resolveRead = () => {
        const runtime = resolve();
        for (const method of ['getCurrentConversation', 'listMessages', 'listParticipants', 'getUnreadCount']) {
            if (typeof runtime[method] !== 'function') throw unavailable();
        }
        return runtime;
    };
    const validateReadScope = (request) => {
        if (!lockedScopeId) lockedScopeId = request.scopeId;
        if (request.scopeId !== lockedScopeId) {
            throw publicError('请求 scope 与消息运行时 facade 不匹配', PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH, {
                expectedScopeId: lockedScopeId,
                receivedScopeId: request.scopeId,
            });
        }
        // When the production runtime knows the currently active SillyTavern chat,
        // a facade belonging to a previous chat must become unreadable after a switch.
        // Test-only runtimes without this private hook retain the explicit scope check.
        const activeScopeId = String(getRuntime?.()?.getActiveScopeId?.() ?? '').trim();
        if (activeScopeId && activeScopeId !== lockedScopeId) {
            throw publicError('消息运行时 facade 已不属于当前聊天 scope', PublicApiErrorCodes.MESSAGE_SCOPE_MISMATCH, {
                expectedScopeId: lockedScopeId,
                activeScopeId,
            });
        }
        return request;
    };
    const read = async (method, payload = {}) => {
        const request = validateReadScope(normalizeReadRequest(payload));
        try {
            return await resolveRead()[method](request);
        } catch (error) {
            throw normalizeReadError(error);
        }
    };

    return Object.freeze({
        async append(payload = {}) {
            const normalized = validatePayload(payload, false);
            // append 与 importHistory 有意共用校验，使单条消息和批量迁移遵循相同
            // 的作用域边界。
            return resolve().append({ ...normalized, message: normalized.messages[0] });
        },
        async importHistory(payload = {}) {
            const normalized = validatePayload(payload, true);
            return resolve().importHistory(normalized);
        },
        async getCurrentConversation(payload = {}) {
            return read('getCurrentConversation', payload);
        },
        async listMessages(payload = {}) {
            const request = validateReadScope(normalizeReadRequest(payload));
            try {
                return await resolveRead().listMessages({
                    ...request,
                    limit: normalizeLimit(payload.limit),
                    beforeMessageId: payload.beforeMessageId === undefined || payload.beforeMessageId === null
                        ? ''
                        : requiredText(payload.beforeMessageId, 'beforeMessageId'),
                });
            } catch (error) {
                throw normalizeReadError(error);
            }
        },
        async listParticipants(payload = {}) {
            return read('listParticipants', payload);
        },
        async getUnreadCount(payload = {}) {
            return read('getUnreadCount', payload);
        },
    });
}
