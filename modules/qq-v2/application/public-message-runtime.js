import { PublicApiErrorCodes } from '../../public-api/errors.js';

function unavailable() {
    const error = new Error('QQ 消息运行时不可用');
    error.name = 'YuziPhonePublicApiError';
    error.code = PublicApiErrorCodes.API_UNAVAILABLE;
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

export function createQQV2PublicMessageRuntime({ getRuntime } = {}) {
    const resolve = () => {
        const runtime = getRuntime?.();
        if (!runtime || typeof runtime.append !== 'function' || typeof runtime.importHistory !== 'function') throw unavailable();
        return runtime;
    };

    return Object.freeze({
        async append(payload = {}) {
            const normalized = validatePayload(payload, false);
            return resolve().append({ ...normalized, message: normalized.messages[0] });
        },
        async importHistory(payload = {}) {
            const normalized = validatePayload(payload, true);
            return resolve().importHistory(normalized);
        },
    });
}
