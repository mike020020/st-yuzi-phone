const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    settingsSchema: 'modules/settings/schema.js',
    settingsPersistence: 'modules/settings/persistence.js',
    settingsPanel: 'modules/settings-panel.js',
    toggleButton: 'modules/bootstrap/toggle-button.js',
    homeRender: 'modules/phone-home/render.js',
    shellCss: 'styles/phone-base/01-shell-system.css',
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

    check(
        results,
        'settingsSchema',
        '默认保留悬浮按钮显示，避免旧用户升级后失去入口',
        has(contents.settingsSchema, 'floatingToggleEnabled: true,')
    );
    check(
        results,
        'settingsSchema',
        '废弃顶部通知气泡设置不再进入默认设置',
        !has(contents.settingsSchema, 'notificationBubblesEnabled: false,')
    );
    check(
        results,
        'settingsSchema',
        '悬浮按钮显示开关继续走 boolean 校验',
        has(contents.settingsSchema, "floatingToggleEnabled: { type: 'boolean' }")
    );
    check(
        results,
        'settingsSchema',
        '废弃顶部通知气泡设置通过 removed key 机制丢弃',
        /export const REMOVED_SETTING_KEYS = new Set\(\[[\s\S]*?'notificationBubblesEnabled'/.test(contents.settingsSchema)
            && has(contents.settingsSchema, 'REMOVED_SETTING_KEYS.has(key)')
            && has(contents.settingsSchema, 'return { valid: true, value: undefined, removed: true };')
            && has(contents.settingsSchema, 'if (result.removed) {\n            continue;\n        }')
    );

    check(
        results,
        'settingsPanel',
        '扩展设置页继续声明悬浮窗开关 checkbox id',
        has(contents.settingsPanel, "const FLOATING_TOGGLE_CHECKBOX_ID = 'yuzi-phone-floating-toggle-enabled';")
    );
    check(
        results,
        'settingsPanel',
        '扩展设置页显示“悬浮窗开关”文案',
        has(contents.settingsPanel, '<span>悬浮窗开关</span>')
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关默认按 floatingToggleEnabled !== false 兼容旧配置',
        has(contents.settingsPanel, 'const isFloatingToggleEnabled = settings.floatingToggleEnabled !== false;')
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关保存到 floatingToggleEnabled 设置键',
        has(contents.settingsPanel, "savePhoneSetting('floatingToggleEnabled', checkbox.checked);")
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关保存后触发现有按钮样式刷新事件',
        has(contents.settingsPanel, "window.dispatchEvent(new CustomEvent('yuzi-phone-toggle-style-updated'));")
    );

    check(
        results,
        'toggleButton',
        'toggle-button 暴露 applyPhoneToggleVisibility()',
        has(contents.toggleButton, 'export function applyPhoneToggleVisibility(')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏会计算 shouldHide 状态',
        has(contents.toggleButton, 'const shouldHide = settings?.floatingToggleEnabled === false;')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏保留 DOM 节点并设置 hidden 属性',
        has(contents.toggleButton, 'btn.hidden = shouldHide;')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏使用 inline display 防止 CSS 覆盖 hidden',
        has(contents.toggleButton, "btn.style.display = shouldHide ? 'none' : '';")
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏同步 aria-hidden 状态',
        has(contents.toggleButton, "btn.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');")
    );
    check(
        results,
        'toggleButton',
        'syncPhoneToggleVisualStyle() 同步样式、位置后再应用可见性',
        has(contents.toggleButton, 'applyPhoneToggleVisualStyle(btn, settings);\n    applyPhoneTogglePosition(btn, { settings, persistIfAdjusted: true });\n    applyPhoneToggleVisibility(btn, settings);')
    );
    check(
        results,
        'toggleButton',
        'createPhoneToggleButton() 复用已绑定按钮时仍应用可见性',
        has(contents.toggleButton, 'if (btn && btn === boundToggleButton) {\n        const settings = getPhoneSettings();\n        applyPhoneToggleVisualStyle(btn, settings);\n        applyPhoneTogglePosition(btn, { settings, persistIfAdjusted: true });\n        applyPhoneToggleVisibility(btn, settings);')
    );
    check(
        results,
        'toggleButton',
        'createPhoneToggleButton() 首次创建后仍返回保留在 DOM 中的按钮',
        has(contents.toggleButton, 'root.appendChild(btn);')
            && has(contents.toggleButton, 'bindPhoneToggleDraggable(btn, onToggle);\n    return btn;')
    );

    check(
        results,
        'settingsPersistence',
        '直接保存废弃顶部通知设置时会删除残留字段',
        has(contents.settingsPersistence, 'if (result.removed) {\n                delete settings[key];\n                schedulePersistSettings(ctx);\n                return true;\n            }')
    );
    check(
        results,
        'settingsPersistence',
        '批量保存废弃顶部通知设置时会删除残留字段',
        has(contents.settingsPersistence, 'if (result.removed) {\n                    delete settings[key];\n                    return;\n                }')
    );
    check(
        results,
        'homeRender',
        '首页表格数量角标继续使用独立 class',
        has(contents.homeRender, "badge.className = 'phone-table-count-badge';")
    );
    check(
        results,
        'shellCss',
        '首页表格数量角标样式保留完整徽标规则',
        has(contents.shellCss, '.phone-table-count-badge {')
            && has(contents.shellCss, 'position: absolute;')
            && has(contents.shellCss, 'top: -4px;')
            && has(contents.shellCss, 'right: -4px;')
    );
    check(
        results,
        'shellCss',
        '顶部通知 DOM/CSS 已移除且不会与首页数量角标混用',
        !has(contents.shellCss, '#phone-notif-container')
            && !has(contents.shellCss, '.phone-notif-bubble')
            && !has(contents.shellCss, '.phone-notif-badge')
    );

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[low-risk-ui-settings-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[low-risk-ui-settings-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
