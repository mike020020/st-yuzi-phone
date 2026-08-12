// v2 完整页面运行时已通过 P1-P4 自动化门禁，由内部发布状态固定启用。
// 不从用户设置、旧预设或 IndexedDB 推导状态，回滚只需恢复此内部常量。
const fullPageRuntimeEnabled = true;

export function isContentPresetFullPageRuntimeEnabled() {
    return fullPageRuntimeEnabled;
}
