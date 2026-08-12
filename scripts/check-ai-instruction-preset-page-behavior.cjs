const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function importModule(relativePath) {
    const href = pathToFileURL(path.join(ROOT, relativePath)).href;
    return import(`${href}?contract=${Date.now()}-${Math.random()}`);
}

async function main() {
    const page = read('modules/settings-app/pages/ai-instruction-presets.js');
    const renderers = read('modules/settings-app/page-renderers.js');

    assert.match(
        page,
        /querySelectorAll\('\.phone-ai-preset-segment-card'\)/,
        '草稿读取只能枚举消息卡，不能把带 data-message-index 的按钮当成消息块',
    );
    assert.doesNotMatch(
        page,
        /querySelectorAll\('\[data-message-index\]'\)/,
        'AI 预设页不得恢复过宽的 data-message-index 草稿选择器',
    );
    assert.match(page, /rerenderAiInstructionPresetsKeepScroll/, 'AI 预设页重绘必须复用统一滚动保留逻辑');
    assert.match(renderers, /'rerenderAiInstructionPresetsKeepScroll'/, 'renderer 依赖校验必须覆盖 AI 预设滚动函数');
    assert.match(page, /phone-ai-instruction-save-as-btn/, 'AI 预设页必须提供另存为按钮');
    assert.doesNotMatch(page, />请选择 AI 指令预设</, '预设下拉框不得保留请选择占位项');
    assert.match(page, /QQ_V2_PROMPT_PLACEHOLDER_DEFINITIONS/, '占位符说明必须读取运行时共享目录');

    const {
        findMisreadControlMessages,
        removeMisreadControlMessages,
    } = await importModule('modules/settings-app/pages/ai-instruction-preset-draft.js');
    const messages = [
        { id: 'real-empty', name: '未命名消息块', role: 'system', content: '' },
        { id: 'real-1', name: '真实消息', role: 'user', content: '保留' },
        { id: 'bad-1', name: '未命名消息块', role: 'system', content: '' },
        { id: 'bad-2', name: '未命名消息块', role: 'system', content: '' },
        { id: 'bad-3', name: '未命名消息块', role: 'system', content: '' },
        { id: 'real-2', name: '结尾', role: 'assistant', content: '保留' },
    ];
    assert.deepEqual(findMisreadControlMessages(messages).indexes, [2, 3, 4]);
    const cleaned = removeMisreadControlMessages(messages);
    assert.equal(cleaned.removedCount, 3);
    assert.deepEqual(cleaned.messages.map(({ id }) => id), ['real-empty', 'real-1', 'real-2']);

    console.log('[ai-instruction-preset-page-behavior] passed');
}

main().catch((error) => {
    console.error('[ai-instruction-preset-page-behavior] failed');
    console.error(error);
    process.exitCode = 1;
});
