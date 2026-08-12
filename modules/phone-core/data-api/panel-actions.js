import { withTimeout } from '../db-bridge.js';
import { openDatabaseUi, openDatabaseVisualizerUi } from './database-ui-bridge.js';

export async function openVisualizerWithStatus(options = {}) {
    const timeoutMs = Number(options.timeoutMs);
    try {
        return await withTimeout(
            openDatabaseVisualizerUi(),
            timeoutMs || 4000,
            '打开可视化编辑器超时',
        );
    } catch (error) {
        const isTimeout = /超时/.test(String(error?.message || ''));
        return {
            ok: false,
            code: isTimeout ? 'timeout' : 'failed',
            source: 'bridge',
            message: isTimeout ? '打开可视化编辑器超时' : `打开可视化编辑器失败：${error?.message || '未知错误'}`,
        };
    }
}

export async function openDatabaseUiWithStatus(options = {}) {
    const timeoutMs = Number(options.timeoutMs);
    try {
        return await withTimeout(
            openDatabaseUi(),
            timeoutMs || 4000,
            '打开数据库界面超时',
        );
    } catch (error) {
        const isTimeout = /超时/.test(String(error?.message || ''));
        return {
            ok: false,
            code: isTimeout ? 'timeout' : 'failed',
            source: 'bridge',
            message: isTimeout ? '打开数据库界面超时' : `打开数据库界面失败：${error?.message || '未知错误'}`,
        };
    }
}

// 兼容旧调用方的历史函数名；实际语义已迁移为“打开数据库 UI”，旧设置面板只作为 bridge fallback。
// 新代码应优先注入 openDatabaseUiWithStatus，不要继续传播 Settings 命名。
export async function openDatabaseSettingsWithStatus(options = {}) {
    return openDatabaseUiWithStatus(options);
}
