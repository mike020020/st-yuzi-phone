const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FILES = {
    settingsRender: 'modules/settings-app/render.js',
    stateMachine: 'modules/settings-app/state-machine.js',
    pageRuntime: 'modules/settings-app/page-runtime.js',
    pageRenderers: 'modules/settings-app/page-renderers.js',
    personalization: 'modules/settings-app/page-renderers/personalization-renderers.js',
    presetRenderers: 'modules/settings-app/page-renderers/preset-renderers.js',
    editor: 'modules/settings-app/page-renderers/editor-renderers.js',
    pageContexts: 'modules/settings-app/page-renderers/page-context-builders.js',
    homePage: 'modules/settings-app/pages/home.js',
    appearancePage: 'modules/settings-app/pages/appearance.js',
    apiPage: 'modules/settings-app/pages/api-presets.js',
    aiPage: 'modules/settings-app/pages/ai-instruction-presets.js',
    buttonStylePage: 'modules/settings-app/pages/button-style.js',
    beautifyPage: 'modules/settings-app/pages/beautify.js',
    types: 'types.d.ts',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function pushCheck(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, read(file)]));
    const results = [];
    for (const relativePath of [
        'modules/settings-app/pages/database.js',
        'modules/settings-app/services/database-page-controller.js',
        'modules/settings-app/services/db-config-runtime.js',
        'modules/settings-app/services/db-presets.js',
        'modules/settings-app/page-renderers/data-config-renderers.js',
        'modules/settings-app/pages/worldbook-workbench.js',
        'modules/settings-app/services/worldbook-selection.js',
        'modules/settings-app/intent.js',
        'modules/settings-app/services/manual-update.js',
    ]) {
        results.push({ file: relativePath, description: '已删除的旧设置链不存在', ok: !fs.existsSync(path.join(ROOT, relativePath)) });
    }
    pushCheck(results, 'settingsRender', 'settings render 注入 QQ v2 Facade 预设服务', contents.settingsRender.includes('qqV2PresetSettingsService'));
    pushCheck(results, 'settingsRender', 'settings render 注册 API 预设页', contents.settingsRender.includes("mode === 'api_presets'"));
    pushCheck(results, 'settingsRender', 'settings render 不再注册数据库页', !contents.settingsRender.includes("mode === 'database'"));
    pushCheck(results, 'settingsRender', 'settings render 不再注入手动更新服务', !contents.settingsRender.includes('setupManualUpdateBtn') && !contents.settingsRender.includes('manualUpdateService'));
    pushCheck(results, 'settingsRender', 'settings render 通过页面 registry 分发生命周期', contents.settingsRender.includes('const pageDefinition = pageRenderers?.pages'));
    pushCheck(results, 'pageRuntime', 'settings page runtime 暴露稳定代理对象', contents.pageRuntime.includes('const pageRuntime = {'));
    pushCheck(results, 'pageRenderers', 'renderer 聚合入口合并预设页面 registry', contents.pageRenderers.includes('const { pages: presetPages = {}, ...presetRenderers } = createPresetPageRenderers(rendererScope);'));
    pushCheck(results, 'pageRenderers', 'renderer 聚合入口执行依赖校验', contents.pageRenderers.includes('validateSettingsRendererDeps(deps);'));
    pushCheck(results, 'pageRenderers', 'renderer 聚合入口不再校验手动更新依赖', !contents.pageRenderers.includes('setupManualUpdateBtn'));
    pushCheck(results, 'personalization', '个性化 renderer 注册首页', contents.personalization.includes('return createHomePage(homeContext);'));
    pushCheck(results, 'presetRenderers', '预设 renderer 解析 pageContexts', contents.presetRenderers.includes('const pageContexts = rendererScope?.pageContexts'));
    pushCheck(results, 'presetRenderers', '预设 renderer 注册 API 页面', contents.presetRenderers.includes('return createApiPresetsPage(apiPresetsContext);'));
    pushCheck(results, 'presetRenderers', '预设 renderer 注册 AI 页面', contents.presetRenderers.includes('return createAiInstructionPresetsPage(aiInstructionPresetsContext);'));
    pushCheck(results, 'editor', '编辑器 renderer 不再导入旧提示词页', !contents.editor.includes('prompt-editor.js'));
    pushCheck(results, 'pageContexts', '页面 context 构建器传递 QQ v2 Facade 预设服务', contents.pageContexts.includes('qqV2PresetService: services.qqV2Presets'));
    pushCheck(results, 'pageContexts', '页面 context 不再传递手动更新服务', !contents.pageContexts.includes('manualUpdateService') && !contents.pageContexts.includes('setupManualUpdateBtn'));
    pushCheck(results, 'homePage', '首页导出显式页面工厂', contents.homePage.includes('export function createHomePage(ctx) {'));
    pushCheck(results, 'homePage', '首页不再绑定手动更新按钮', !contents.homePage.includes('phone-top-trigger-update') && !contents.homePage.includes('setupManualUpdateBtn'));
    pushCheck(results, 'apiPage', 'API 页导出显式页面工厂', contents.apiPage.includes('export function createApiPresetsPage(ctx) {'));
    pushCheck(results, 'aiPage', 'AI 页导出显式页面工厂', contents.aiPage.includes('export function createAiInstructionPresetsPage(ctx) {'));
    pushCheck(results, 'aiPage', 'AI 页不读取旧 QQ 数据层', !contents.aiPage.includes('../../qq/data/'));
    pushCheck(results, 'appearancePage', '外观页导出显式页面工厂', contents.appearancePage.includes('export function createAppearancePage(ctx) {'));
    pushCheck(results, 'buttonStylePage', '按钮样式页导出显式页面工厂', contents.buttonStylePage.includes('export function createButtonStylePage(ctx) {'));
    pushCheck(results, 'beautifyPage', '美化工坊导出显式页面工厂', contents.beautifyPage.includes('export function createBeautifyTemplatePage(ctx) {'));
    pushCheck(results, 'stateMachine', '设置状态保留 API 预设滚动位置', contents.stateMachine.includes('apiPresetsScrollTop'));
    pushCheck(results, 'types', 'SettingsPageMode 使用 api_presets', contents.types.includes("| 'api_presets'"));
    pushCheck(results, 'types', 'SettingsPageMode 不再包含 database', !contents.types.includes("| 'database'"));
    pushCheck(results, 'types', 'SettingsPageRendererGroupedDeps 声明 QQ v2 预设服务', contents.types.includes('qqV2Presets?: SettingsQQV2PresetService'));
    pushCheck(results, 'types', '设置类型不再声明手动更新服务', !contents.types.includes('SettingsManualUpdateService') && !contents.types.includes('SettingsHomePageRendererDeps'));
    const failed = results.filter(item => !item.ok);
    if (failed.length) {
        console.error('[settings-renderers-check] 检查失败：');
        failed.forEach(item => console.error(`- ${item.file}: ${item.description}`));
        process.exitCode = 1;
        return;
    }
    console.log('[settings-renderers-check] 检查通过');
}

main();
