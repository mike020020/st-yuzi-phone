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
 * @param {{getRuntime?: () => {append:Function,importHistory:Function}|null}} [options]
 * @returns {Readonly<{append:Function,importHistory:Function}>} 冻结的公开消息接口。
 */
export function createQQV2PublicMessageRuntime({ getRuntime } = {}) {
    const resolve = () => {
        // 延迟解析：QQ 运行时在扩展启动后创建并于销毁时释放，绝不缓存过期实例。
        const runtime = getRuntime?.();
        if (!runtime || typeof runtime.append !== 'function' || typeof runtime.importHistory !== 'function') throw unavailable();
        return runtime;
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
    });
}
