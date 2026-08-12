import { Logger } from '../error-handler.js';

let stContext = null;

function resolveSillyTavernContext() {
    try {
        if (typeof getContext !== 'undefined' && typeof getContext === 'function') {
            return getContext();
        }

        if (typeof window !== 'undefined') {
            if (typeof window.getContext === 'function') {
                return window.getContext();
            }

            if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
                return window.SillyTavern.getContext();
            }
        }

        return null;
    } catch (error) {
        Logger.debug('[玉子手机] 获取 SillyTavern 上下文失败:', error);
        return null;
    }
}

/**
 * 每次都从宿主重新读取 context。
 *
 * 对于会话级功能，SillyTavern 在切换聊天时会替换 metadata 引用，因此不能复用
 * 早先缓存的 context。
 *
 * @returns {object | null}
 */
export function getFreshSillyTavernContext() {
    const context = resolveSillyTavernContext();
    if (context) {
        stContext = context;
    }
    return context;
}

/**
 * 获取可缓存的 SillyTavern context。
 *
 * @param {{fresh?: boolean} | boolean} [options]
 * @returns {object | null}
 */
export function getSillyTavernContext(options = {}) {
    const fresh = options === true || options?.fresh === true;
    if (!fresh && stContext) {
        return stContext;
    }

    return getFreshSillyTavernContext();
}

export function clearSillyTavernContextCache() {
    stContext = null;
}
