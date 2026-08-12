const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

const LEGACY_PATHS = [
    'modules/qq',
    'styles/14-qq.css',
    'scripts/check-qq-media-contract.cjs',
    'scripts/check-qq-prompt-presets-contract.cjs',
    'scripts/check-qq-protocol-contract.cjs',
    'scripts/check-qq-repository-integrity-contract.cjs',
    'scripts/check-qq-runtime-contract.cjs',
    'scripts/check-qq-settings-contract.cjs',
    'scripts/check-qq-worldbook-contract.cjs',
];

const LEGACY_MESSAGE_RECORD_FILES = [
    'modules/phone-core/chat-support.js',
    'styles/03-phone-special-base.css',
    'styles/04-phone-special-interactions.css',
];

const LEGACY_MESSAGE_RECORD_DIRECTORIES = [
    'modules/phone-core/chat-support',
    'modules/table-viewer/special',
];

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function hasFiles(relativePath) {
    const target = path.join(ROOT, relativePath);
    if (!fs.existsSync(target)) return false;

    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const childPath = path.join(relativePath, entry.name);
        if (entry.isFile() || entry.isSymbolicLink() || hasFiles(childPath)) return true;
    }

    return false;
}

function assertDoesNotInclude(source, needle, label) {
    assert.equal(source.includes(needle), false, `${label} 不得保留 ${needle}`);
}

function main() {
    assert.equal(hasFiles('modules/qq'), false, '旧 QQ v1 目录不得保留文件');
    for (const relativePath of LEGACY_PATHS.slice(1)) {
        assert.equal(exists(relativePath), false, `旧 QQ v1 资源必须删除：${relativePath}`);
    }
    for (const relativePath of LEGACY_MESSAGE_RECORD_FILES) {
        assert.equal(exists(relativePath), false, `旧消息记录表专属文件必须删除：${relativePath}`);
    }
    for (const relativePath of LEGACY_MESSAGE_RECORD_DIRECTORIES) {
        assert.equal(hasFiles(relativePath), false, `旧消息记录表专属目录不得保留文件：${relativePath}`);
    }

    const packageJson = JSON.parse(read('package.json'));
    const styleEntry = read('style.css');
    const styleContract = read('scripts/check-style-entry-contract.cjs');
    const entry = read('index.js');
    const eventRegistry = read('modules/bootstrap/event-registry.js');
    const routeRenderer = read('modules/phone-core/route-renderer.js');
    const homeViewModel = read('modules/phone-home/view-model.js');
    const qqAppDefinition = read('modules/qq-v2/app-definition.js');
    const architectureGuide = read('docs/architecture-guide.md');
    const theaterRegistry = read('modules/phone-theater/scenes/index.js');
    const theaterSquare = read('modules/phone-theater/scenes/square.js');
    const theaterForum = read('modules/phone-theater/scenes/forum.js');
    const builtinTemplates = read('modules/phone-beautify-templates/defaults/builtin-templates.js');
    const matcherHelpers = read('modules/phone-beautify-templates/matcher-helpers.js');
    const matcher = read('modules/phone-beautify-templates/matcher.js');

    assert.equal(
        packageJson.scripts?.['check:qq-v1-removal'],
        'node scripts/check-qq-v1-removal-contract.cjs',
        'package.json 必须提供旧 QQ v1 删除合同命令',
    );

    assertDoesNotInclude(styleEntry, 'styles/14-qq.css', '样式入口');
    assert.doesNotMatch(styleContract, /qq:\s*'styles\/14-qq\.css'/, '样式合同不得再读取旧 QQ 样式文件');
    assert.doesNotMatch(styleContract, /check\(results, 'qq'/, '样式合同不得保留旧 QQ 样式断言');

    for (const needle of [
        './modules/qq/',
        'initializeQQRuntime',
        'destroyQQRuntime',
        'handleQQChatChanged',
        'handleQQCharacterMessageRendered',
        'handleQQGenerationStarted',
        'handleQQWorldInfoActivated',
    ]) {
        assertDoesNotInclude(entry, needle, '扩展入口');
    }

    for (const needle of [
        'onQQChatChanged',
        'onQQCharacterMessageRendered',
        'onQQGenerationStarted',
        'onQQWorldInfoActivated',
    ]) {
        assertDoesNotInclude(eventRegistry, needle, '宿主事件注册');
    }

    assertDoesNotInclude(routeRenderer, '../qq/ui/render.js', '路由渲染器');
    assertDoesNotInclude(routeRenderer, 'renderQQApp', '路由渲染器');
    assert.match(routeRenderer, /routeType:\s*'qq'/, 'QQ 图标必须路由到 QQ v2 生命周期');
    assert.match(routeRenderer, /createQQRouteLifecycle/, 'QQ 路由必须挂载 QQ v2 生命周期');
    assert.match(routeRenderer, /renderQQRouteFailure/, 'QQ v2 加载失败时必须保留安全 fallback，而不是旧 QQ 界面');
    assert.match(qqAppDefinition, /export const QQ_APP = Object\.freeze\(/, 'QQ v2 必须提供共享 App 定义');
    assert.match(qqAppDefinition, /id:\s*'__qq__'/, 'QQ App id 必须保持稳定');
    assert.match(qqAppDefinition, /route:\s*'qq'/, 'QQ App route 必须保持稳定');
    assert.match(homeViewModel, /from '\.\.\/qq-v2\/app-definition\.js'/, '首页必须复用 QQ v2 App 定义');
    assert.match(homeViewModel, /route:\s*QQ_APP\.route/, '首页 QQ App 必须继续有稳定 route');

    assertDoesNotInclude(architectureGuide, 'modules/qq/', '架构文档');
    assertDoesNotInclude(theaterRegistry, 'sheet_IVu96w0X', '小剧场 registry');
    assertDoesNotInclude(theaterRegistry, '消息记录表', '小剧场 registry');
    assert.match(theaterSquare, /appKey:\s*'__theater_square'/, '广场小剧场必须保留');
    assert.match(theaterForum, /appKey:\s*'__theater_forum'/, '论坛小剧场必须保留');
    assertDoesNotInclude(builtinTemplates, 'builtin.special.message.v1', '内置美化模板');
    assertDoesNotInclude(matcherHelpers, 'inferSpecialRendererKeyByTableName', '美化匹配器');
    assertDoesNotInclude(matcher, 'detectSpecialTemplateForTable', '美化匹配器');
    assertDoesNotInclude(matcher, 'PHONE_TEMPLATE_TYPE_SPECIAL', '美化匹配器');

    console.log('[qq-v1-removal-contract] 检查通过');
}

main();
