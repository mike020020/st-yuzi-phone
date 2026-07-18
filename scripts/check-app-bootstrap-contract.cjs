const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    index: 'index.js',
    appBootstrap: 'modules/bootstrap/app-bootstrap.js',
    eventRegistry: 'modules/bootstrap/event-registry.js',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];
    const unmountStart = contents.appBootstrap.indexOf('export function unmountPhoneBootstrapUi()');
    const unmountEnd = contents.appBootstrap.indexOf('export function getMountedPhoneBootstrapUi()');
    const unmountBody = unmountStart >= 0 && unmountEnd > unmountStart ? contents.appBootstrap.slice(unmountStart, unmountEnd) : '';

    check(results, 'appBootstrap', '继续暴露 mountPhoneBootstrapUi()', has(contents.appBootstrap, 'export function mountPhoneBootstrapUi('));
    check(results, 'appBootstrap', '继续暴露 unmountPhoneBootstrapUi()', has(contents.appBootstrap, 'export function unmountPhoneBootstrapUi('));
    check(results, 'appBootstrap', '继续暴露 initializePhoneBootstrapUi()', has(contents.appBootstrap, 'export async function initializePhoneBootstrapUi('));
    check(results, 'appBootstrap', '继续暴露 togglePhoneBootstrapVisibility()', has(contents.appBootstrap, 'export function togglePhoneBootstrapVisibility('));
    check(results, 'appBootstrap', '继续暴露 setPhoneBootstrapEnabledState()', has(contents.appBootstrap, 'export function setPhoneBootstrapEnabledState('));
    check(results, 'appBootstrap', 'app-bootstrap 继续创建设置面板', has(contents.appBootstrap, 'createPhoneSettingsPanel'));
    check(results, 'appBootstrap', 'app-bootstrap 继续注册事件监听', has(contents.appBootstrap, 'await registerEventListeners();'));
    check(results, 'appBootstrap', '普通 unmountPhoneBootstrapUi() 不删除 settings panel', !has(unmountBody, 'yuzi-phone-settings') && !has(unmountBody, 'destroyPhoneSettingsPanel'));

    check(results, 'index', 'index 导入 initializePhoneBootstrapUi()', has(contents.index, 'initializePhoneBootstrapUi'));
    check(results, 'index', 'index 导入 togglePhoneBootstrapVisibility()', has(contents.index, 'togglePhoneBootstrapVisibility'));
    check(results, 'index', 'index 导入 setPhoneBootstrapEnabledState()', has(contents.index, 'setPhoneBootstrapEnabledState'));
    check(results, 'index', 'togglePhone() 继续委托 bootstrap visibility helper', has(contents.index, 'return togglePhoneBootstrapVisibility(show, {'));
    check(results, 'index', 'setPhoneEnabledWithUI() 启用时挂载 UI 并启动后台服务', has(contents.index, 'setPhoneBootstrapEnabledState(true, {') && has(contents.index, "startPhoneBackgroundServices('settings-enabled');"));
    check(results, 'index', 'setPhoneEnabledWithUI() 禁用时先停止后台服务并销毁 runtime', has(contents.index, "stopPhoneBackgroundServices('settings-disabled');") && has(contents.index, 'destroyPhoneRuntime();') && has(contents.index, 'setPhoneBootstrapEnabledState(false, {'));
    check(results, 'index', 'setPhoneEnabledWithUI() 禁用时取消可见主页刷新屏障', has(contents.index, "cancelPendingHomeRefresh('settings-disabled');"));
    check(results, 'index', 'doInitialize() 使用 bootstrap settings 决定后台服务状态', has(contents.index, 'const { settings } = await initializePhoneBootstrapUi({') && has(contents.index, 'if (settings?.enabled !== false) {'));
    check(results, 'index', 'doInitialize() 继续委托 initializePhoneBootstrapUi()', has(contents.index, 'await initializePhoneBootstrapUi({'));
    check(results, 'index', '初始化失败时停止后台服务，避免失败实例残留订阅', has(contents.index, "stopPhoneBackgroundServices('initialize-failed');"));
    check(results, 'eventRegistry', '聊天切换无论手机是否可见都先通知后台服务', has(contents.eventRegistry, 'onBackgroundChatChanged?.(chatId);') && contents.eventRegistry.indexOf('onBackgroundChatChanged?.(chatId);') < contents.eventRegistry.indexOf("container.classList.contains('visible')"));

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[app-bootstrap-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[app-bootstrap-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
