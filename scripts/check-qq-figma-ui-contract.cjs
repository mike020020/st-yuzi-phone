const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const escapeRegExp = (value) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

function finalTokenValue(source, token) {
    const declaration = new RegExp(escapeRegExp(token) + '\\s*:\\s*([^;]+);', 'g');
    let match;
    let value = '';
    while ((match = declaration.exec(source))) value = match[1].trim();
    return value;
}

function assertFinalToken(source, token, expected, description) {
    assert.equal(
        finalTokenValue(source, token).toLowerCase(),
        expected.toLowerCase(),
        description || (token + ' must finish as ' + expected),
    );
}

function assertTokenExists(source, token, description) {
    assert.match(source, new RegExp(escapeRegExp(token) + '\\s*:'), description || ('Missing token ' + token));
}

function cssBlocks(source, selector) {
    const pattern = new RegExp('(?:^|\\})[^{}]*' + escapeRegExp(selector) + '[^{}]*\\{([^}]*)\\}', 'gm');
    return Array.from(source.matchAll(pattern), (match) => match[1]);
}

function assertRuleUses(source, selector, token, description) {
    const blocks = cssBlocks(source, selector);
    assert.ok(blocks.length > 0, (description || selector) + ' must have a CSS rule');
    assert.ok(
        blocks.some((block) => block.includes('var(' + token + ')')),
        (description || selector) + ' must consume ' + token,
    );
}

function assertRuleDeclaration(source, selector, property, token, description) {
    const declaration = new RegExp(
        escapeRegExp(property) + '\\s*:\\s*[^;]*var\\(' + escapeRegExp(token) + '\\)',
    );
    const blocks = cssBlocks(source, selector);
    assert.ok(blocks.length > 0, (description || selector) + ' must have a CSS rule');
    assert.ok(
        blocks.some((block) => declaration.test(block)),
        (description || selector) + ' must set ' + property + ' through ' + token,
    );
}

function assertThemeRole(tokens, role, lightRefs, darkRefs) {
    const rolePattern = escapeRegExp(role) + '\\s*:\\s*var\\((?:';
    const lightPattern = new RegExp(rolePattern + lightRefs.map(escapeRegExp).join('|') + ')\\)\\s*;');
    const darkPattern = new RegExp(rolePattern + darkRefs.map(escapeRegExp).join('|') + ')\\)\\s*;');
    assert.match(tokens, lightPattern, role + ' must map to an actual Figma light role');
    assert.match(tokens, darkPattern, role + ' must map to an actual Figma dark role');
}

function main() {
    const app = read('modules/qq-v2/ui/app.js');
    const tokens = read('styles/phone-base/00-phone-tokens.css');
    const css = read('styles/phone-base/12-qq-app.css');
    const variables = read('docs/phone-ui-variables.md');

    assert.doesNotMatch(
        css,
        /\.yuzi-qq-app\s+button\s*\{[^}]*background\s*:\s*none\s*;/s,
        'the QQ button reset must not outrank component background rules',
    );
    assert.match(
        css,
        /(?::where\(\.yuzi-qq-app\)\s+button|\.yuzi-qq-app\s+:where\(button\))\s*\{[^}]*background\s*:\s*none\s*;/s,
        'the QQ button reset must stay scoped with deliberately low specificity',
    );
    assert.match(
        css,
        /:where\(\.yuzi-qq-app\)\s+:where\(button, input, textarea, select\)\s*\{[^}]*color\s*:\s*inherit\s*;/s,
        'the QQ control reset must not outrank semantic component colors',
    );
    for (const [token, expected] of [
        ['--yuzi-qq-light-avatar', 'var(--yuzi-qq-light-page)'],
        ['--yuzi-qq-light-avatar-text', '#cacaca'],
        ['--yuzi-qq-light-avatar-ink', 'var(--yuzi-qq-light-avatar-text)'],
        ['--yuzi-qq-dark-avatar', 'var(--yuzi-qq-dark-tab-surface)'],
        ['--yuzi-qq-dark-avatar-text', 'var(--yuzi-qq-dark-icon)'],
        ['--yuzi-qq-dark-avatar-ink', 'var(--yuzi-qq-dark-avatar-text)'],
    ]) {
        assertFinalToken(tokens, token, expected, token + ' must keep person placeholders separate from the current-user accent avatar');
    }
    for (const selector of ['.yuzi-qq-avatar', '.yuzi-qq-contact-initial']) {
        assertRuleDeclaration(css, selector, 'color', '--yuzi-qq-avatar-ink', selector + ' text fallback');
        assertRuleDeclaration(css, selector, 'background', '--yuzi-qq-avatar-surface', selector + ' text fallback');
    }
    assertRuleDeclaration(css, '.yuzi-qq-identity-avatar', 'color', '--yuzi-qq-on-accent', 'identity avatar text fallback');
    assertRuleDeclaration(css, '.yuzi-qq-identity-avatar', 'background', '--yuzi-qq-accent', 'identity avatar text fallback');

    // Agreed static seam: Figma 02 variables -> QQ tokens -> QQ DOM/CSS selectors.
    assert.match(app, /export function createQQApp\(/, 'QQ UI must expose an injectable root renderer');
    assert.match(app, /facade/, 'QQ UI must consume its injected Facade');
    assert.doesNotMatch(app, /indexedDB|repository|worldbookGateway|requestService/, 'QQ UI must not access runtime internals');

    const tabs = app.match(/const TABS = Object\.freeze\(\[([\s\S]*?)\]\);/);
    assert.ok(tabs, 'QQ must define the fixed root tab list');
    for (const [route, label] of [
        ['messages', '消息'],
        ['contacts', '联系人'],
        ['assistant', '助手'],
        ['settings', '设置'],
    ]) {
        assert.match(tabs[1], new RegExp("\\['" + route + "',\\s*'" + label + "'\\]"), 'QQ root tabs must include ' + label);
    }
    assert.doesNotMatch(tabs[1], /频道|动态/, 'Figma source tabs must not replace the agreed QQ root tabs');
    assert.doesNotMatch(app, /yuzi-qq-(?:status-bar|home-indicator)/, 'Phone shell owns the status bar and Home Indicator');
    assert.doesNotMatch(app, /data-qq-theme|setQqTheme|toggleQqTheme/, 'QQ must consume the phone theme rather than own a theme switch');

    const figmaColors = [
        ['--yuzi-qq-light-page', '#f2f3f5'],
        ['--yuzi-qq-light-surface', '#ffffff'],
        ['--yuzi-qq-light-list-surface', '#ffffff'],
        ['--yuzi-qq-light-tab-surface', '#f2f3f5'],
        ['--yuzi-qq-light-text', '#171a1d'],
        ['--yuzi-qq-light-muted', '#7a828c'],
        ['--yuzi-qq-light-weak', '#a8adb4'],
        ['--yuzi-qq-light-icon', '#3b4047'],
        ['--yuzi-qq-light-accent', '#0099ff'],
        ['--yuzi-qq-light-success', '#15d173'],
        ['--yuzi-qq-light-line', '#e5e5e5'],
        ['--yuzi-qq-light-search', '#f8f8f8'],
        ['--yuzi-qq-light-chat-header', '#eeefef'],
        ['--yuzi-qq-light-settings-page', '#f1f2f6'],
        ['--yuzi-qq-light-settings-group', '#feffff'],
        ['--yuzi-qq-light-settings-outline', '#e8e7e8'],
        ['--yuzi-qq-dark-page', '#212325'],
        ['--yuzi-qq-dark-surface', '#212325'],
        ['--yuzi-qq-dark-list-surface', '#1a1c1e'],
        ['--yuzi-qq-dark-tab-surface', '#2c2d2e'],
        ['--yuzi-qq-dark-text', '#f0f0f4'],
        ['--yuzi-qq-dark-muted', '#909094'],
        ['--yuzi-qq-dark-weak', '#5f6061'],
        ['--yuzi-qq-dark-icon', '#c6c6ca'],
        ['--yuzi-qq-dark-accent', '#0066cc'],
        ['--yuzi-qq-dark-success', '#34c759'],
        ['--yuzi-qq-dark-line', '#3a3c3e'],
        ['--yuzi-qq-dark-search', '#2c2e2f'],
        ['--yuzi-qq-dark-chat-header', '#1a1b1c'],
        ['--yuzi-qq-dark-deep', '#0f1113'],
        ['--yuzi-qq-dark-deep-surface', '#242628'],
        ['--yuzi-qq-dark-settings-page', '#000000'],
        ['--yuzi-qq-dark-settings-group', '#1c1c1e'],
        ['--yuzi-qq-dark-settings-outline', '#38383b'],
        ['--yuzi-qq-dark-unread', '#3c3e3f'],
    ];
    for (const [token, value] of figmaColors) {
        assertFinalToken(tokens, token, value, token + ' must use its measured Figma 02 value');
    }

    for (const [role, lightRefs, darkRefs] of [
        ['--yuzi-qq-page', ['--yuzi-qq-light-page'], ['--yuzi-qq-dark-page']],
        ['--yuzi-qq-surface', ['--yuzi-qq-light-surface'], ['--yuzi-qq-dark-surface']],
        ['--yuzi-qq-list-surface', ['--yuzi-qq-light-list-surface'], ['--yuzi-qq-dark-list-surface']],
        ['--yuzi-qq-tab-surface', ['--yuzi-qq-light-tab-surface'], ['--yuzi-qq-dark-tab-surface']],
        ['--yuzi-qq-chat-header-surface', ['--yuzi-qq-light-chat-header'], ['--yuzi-qq-dark-chat-header']],
        ['--yuzi-qq-composer-surface', ['--yuzi-qq-light-composer'], ['--yuzi-qq-dark-composer']],
        ['--yuzi-qq-text', ['--yuzi-qq-light-text', '--yuzi-qq-light-main'], ['--yuzi-qq-dark-text', '--yuzi-qq-dark-main']],
        ['--yuzi-qq-muted', ['--yuzi-qq-light-muted', '--yuzi-qq-light-secondary'], ['--yuzi-qq-dark-muted', '--yuzi-qq-dark-secondary']],
        ['--yuzi-qq-icon', ['--yuzi-qq-light-icon'], ['--yuzi-qq-dark-icon']],
        ['--yuzi-qq-accent', ['--yuzi-qq-light-accent', '--yuzi-qq-light-brand'], ['--yuzi-qq-dark-accent', '--yuzi-qq-dark-brand']],
        ['--yuzi-qq-line', ['--yuzi-qq-light-line', '--yuzi-qq-light-border'], ['--yuzi-qq-dark-line', '--yuzi-qq-dark-border']],
        ['--yuzi-qq-bubble-self', ['--yuzi-qq-light-bubble-self'], ['--yuzi-qq-dark-bubble-self']],
        ['--yuzi-qq-bubble-other', ['--yuzi-qq-light-bubble-other'], ['--yuzi-qq-dark-bubble-other']],
        ['--yuzi-qq-dialog-surface', ['--yuzi-qq-light-dialog'], ['--yuzi-qq-dark-dialog']],
        ['--yuzi-qq-settings-page', ['--yuzi-qq-light-settings-page'], ['--yuzi-qq-dark-settings-page']],
        ['--yuzi-qq-settings-group', ['--yuzi-qq-light-settings-group'], ['--yuzi-qq-dark-settings-group']],
        ['--yuzi-qq-settings-outline', ['--yuzi-qq-light-settings-outline'], ['--yuzi-qq-dark-settings-outline']],
    ]) {
        assertThemeRole(tokens, role, lightRefs, darkRefs);
    }

    const figmaTypography = [
        ['--yuzi-qq-root-title-size', 'calc(17px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-root-title-weight', '700'],
        ['--yuzi-qq-row-title-size', 'calc(14px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-row-title-weight', '500'],
        ['--yuzi-qq-row-preview-size', 'calc(11px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-caption-size', 'calc(9px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-body-size', 'calc(14px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-body-weight', '400'],
        ['--yuzi-qq-chat-title-size', 'calc(16px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-chat-title-weight', '500'],
        ['--yuzi-qq-time-divider-size', 'calc(10px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-nav-label-size', 'calc(11px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-nav-label-weight', '400'],
        ['--yuzi-qq-nav-label-active-weight', '500'],
        ['--yuzi-qq-profile-name-size', 'calc(24px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-profile-name-weight', '500'],
        ['--yuzi-qq-profile-copy-size', 'calc(14px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-profile-copy-line-height', 'calc(16px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-profile-action-size', 'calc(16px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-profile-action-weight', '400'],
        ['--yuzi-qq-editor-title-size', 'calc(17px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-editor-title-weight', '500'],
        ['--yuzi-qq-editor-field-size', 'calc(16px * var(--yuzi-qq-readable-text-scale))'],
        ['--yuzi-qq-editor-field-weight', '400'],
        ['--yuzi-qq-settings-root-title-size', 'var(--yuzi-qq-editor-title-size)'],
        ['--yuzi-qq-settings-row-size', 'var(--yuzi-qq-profile-action-size)'],
        ['--yuzi-qq-settings-detail-field-label-size', 'var(--yuzi-qq-editor-field-size)'],
    ];
    for (const [token, value] of figmaTypography) {
        assertFinalToken(tokens, token, value, token + ' must keep its Figma typography role');
    }

    for (const [selector, property, token] of [
        ['.yuzi-qq-app', 'font-weight', '--yuzi-qq-body-weight'],
        ['.yuzi-qq-identity-title', 'font-weight', '--yuzi-qq-root-title-weight'],
        ['.yuzi-qq-row-title', 'font-weight', '--yuzi-qq-row-title-weight'],
        ['.yuzi-qq-row-preview', 'font-weight', '--yuzi-qq-body-weight'],
        ['.yuzi-qq-row-meta', 'font-weight', '--yuzi-qq-body-weight'],
        ['.yuzi-qq-nav-item', 'font-weight', '--yuzi-qq-nav-label-weight'],
        ['.yuzi-qq-nav-item.is-active', 'font-weight', '--yuzi-qq-nav-label-active-weight'],
        ['.yuzi-qq-chat-title', 'font-size', '--yuzi-qq-chat-title-size'],
        ['.yuzi-qq-chat-title', 'font-weight', '--yuzi-qq-chat-title-weight'],
        ['.yuzi-qq-composer-input', 'font-weight', '--yuzi-qq-composer-weight'],
        ['.yuzi-qq-profile-name', 'font-weight', '--yuzi-qq-profile-name-weight'],
        ['.yuzi-qq-profile-summary', 'font-size', '--yuzi-qq-profile-copy-size'],
        ['.yuzi-qq-profile-signature', 'font-weight', '--yuzi-qq-profile-signature-weight'],
        ['.yuzi-qq-settings-root-title', 'font-weight', '--yuzi-qq-settings-root-title-weight'],
        ['.yuzi-qq-settings-root-row', 'font-weight', '--yuzi-qq-settings-row-weight'],
        ['.yuzi-qq-settings-detail-view .yuzi-qq-field', 'font-size', '--yuzi-qq-editor-field-size'],
    ]) {
        assertRuleDeclaration(css, selector, property, token, selector + ' typography');
    }

    const figmaGeometry = [
        ['--yuzi-qq-screen-width', '402px'],
        ['--yuzi-qq-screen-height', '874px'],
        ['--yuzi-qq-page-radius', '47px'],
        ['--yuzi-qq-status-height', '62px'],
        ['--yuzi-qq-root-header-height', '58px'],
        ['--yuzi-qq-root-identity-avatar-size', '38px'],
        ['--yuzi-qq-root-action-size', '28px'],
        ['--yuzi-qq-root-status-dot-size', '12px'],
        ['--yuzi-qq-tabbar-height', '83px'],
        ['--yuzi-qq-nav-item-width', '82px'],
        ['--yuzi-qq-tab-content-height', '49px'],
        ['--yuzi-qq-nav-icon-size', '26px'],
        ['--yuzi-qq-nav-item-gap', '1px'],
        ['--yuzi-qq-list-search-sheet-height', '60px'],
        ['--yuzi-qq-search-height', '36px'],
        ['--yuzi-qq-search-radius', '12px'],
        ['--yuzi-qq-conversation-row-height', '76px'],
        ['--yuzi-qq-conversation-avatar-size', '52px'],
        ['--yuzi-qq-chat-header-height', '54px'],
        ['--yuzi-qq-chat-avatar-size', '40px'],
        ['--yuzi-qq-chat-bubble-max-width', '278px'],
        ['--yuzi-qq-chat-bubble-content-max-width', '254px'],
        ['--yuzi-qq-bubble-padding-block', '9px'],
        ['--yuzi-qq-bubble-padding-inline', '12px'],
        ['--yuzi-qq-bubble-radius', '12px'],
        ['--yuzi-qq-composer-height', '88px'],
        ['--yuzi-qq-composer-input-height', '40px'],
        ['--yuzi-qq-tool-size', '24px'],
        ['--yuzi-qq-tool-icon-size', '24px'],
        ['--yuzi-qq-tool-interval', '40px'],
        ['--yuzi-qq-jump-width', '35px'],
        ['--yuzi-qq-jump-height', '35px'],
        ['--yuzi-qq-jump-icon-size', '18px'],
        ['--yuzi-qq-profile-sheet-start', '226px'],
        ['--yuzi-qq-profile-sheet-radius', '20px 20px 0 0'],
        ['--yuzi-qq-profile-avatar-size', '68px'],
        ['--yuzi-qq-profile-action-content-height', '49px'],
        ['--yuzi-qq-profile-action-bar-height', 'var(--yuzi-qq-profile-action-content-height)'],
        ['--yuzi-qq-profile-action-radius', '8px'],
        ['--yuzi-qq-editor-group-radius', '14px'],
        ['--yuzi-qq-form-group-gap', '10px'],
        ['--yuzi-qq-dialog-menu-width', '168px'],
        ['--yuzi-qq-dialog-menu-height', '142px'],
        ['--yuzi-qq-dialog-menu-radius', '14px'],
        ['--yuzi-qq-dialog-menu-padding', '16px'],
        ['--yuzi-qq-settings-root-group-radius', 'var(--yuzi-qq-editor-group-radius)'],
        ['--yuzi-qq-settings-detail-card-radius', 'var(--yuzi-qq-secondary-group-radius)'],
    ];
    for (const [token, value] of figmaGeometry) {
        assertFinalToken(tokens, token, value, token + ' must use the measured Figma 02 geometry');
    }

    const domMarkers = [
        'yuzi-qq-identity-header',
        'yuzi-qq-identity-avatar',
        'yuzi-qq-nav',
        'yuzi-qq-nav-item',
        'yuzi-qq-list-sheet',
        'yuzi-qq-contact-list-sheet',
        'yuzi-qq-swipe-row',
        'yuzi-qq-chat-header',
        'yuzi-qq-message-bubble',
        'yuzi-qq-composer',
        'yuzi-qq-tool-bar',
        'yuzi-qq-emoji-panel',
        'yuzi-qq-jump-bubble',
        'yuzi-qq-profile-sheet',
        'yuzi-qq-profile-action-bar',
        'yuzi-qq-profile-editor-list',
        'yuzi-qq-profile-editor-row',
        'yuzi-qq-secondary-page',
        'yuzi-qq-secondary-top',
        'yuzi-qq-secondary-scroll',
        'yuzi-qq-field-row',
        'yuzi-qq-settings-view',
        'yuzi-qq-settings-sheet',
        'yuzi-qq-dialog-menu',
    ];
    for (const marker of domMarkers) {
        assert.match(app, new RegExp(escapeRegExp(marker)), 'QQ DOM must render ' + marker);
    }

    const selectorTokenPairs = [
        ['.yuzi-qq-identity-header', '--yuzi-qq-root-header-height'],
        ['.yuzi-qq-identity-avatar', '--yuzi-qq-root-identity-avatar-size'],
        ['.yuzi-qq-identity-action', '--yuzi-qq-root-action-size'],
        ['.yuzi-qq-nav', '--yuzi-qq-nav-height'],
        ['.yuzi-qq-nav-item', '--yuzi-qq-nav-item-width'],
        ['.yuzi-qq-nav-item', '--yuzi-qq-nav-item-gap'],
        ['.yuzi-qq-nav-icon', '--yuzi-qq-nav-icon-size'],
        ['.yuzi-qq-list-sheet', '--yuzi-qq-list-surface'],
        ['.yuzi-qq-search', '--yuzi-qq-search-height'],
        ['.yuzi-qq-conversation-row', '--yuzi-qq-conversation-row-height'],
        ['.yuzi-qq-avatar', '--yuzi-qq-conversation-avatar-size'],
        ['.yuzi-qq-swipe-delete', '--yuzi-qq-danger'],
        ['.yuzi-qq-chat-header', '--yuzi-qq-chat-header-height'],
        ['.yuzi-qq-message-avatar', '--yuzi-qq-chat-avatar-size'],
        ['.yuzi-qq-message-bubble', '--yuzi-qq-chat-bubble-max-width'],
        ['.yuzi-qq-message-bubble', '--yuzi-qq-bubble-padding-inline'],
        ['.yuzi-qq-composer', '--yuzi-qq-composer-height'],
        ['.yuzi-qq-composer-input', '--yuzi-qq-composer-input-height'],
        ['.yuzi-qq-tool-button', '--yuzi-qq-tool-icon-size'],
        ['.yuzi-qq-jump-bubble', '--yuzi-qq-jump-width'],
        ['.yuzi-qq-profile-sheet', '--yuzi-qq-profile-sheet-radius'],
        ['.yuzi-qq-profile-row', '--yuzi-qq-profile-row-height'],
        ['.yuzi-qq-avatar-large', '--yuzi-qq-profile-avatar-size'],
        ['.yuzi-qq-profile-action-bar', '--yuzi-qq-profile-action-bar-height'],
        ['.yuzi-qq-profile-editor-group', '--yuzi-qq-secondary-group-radius'],
        ['.yuzi-qq-field-row.is-checkbox', '--yuzi-qq-checkbox-size'],
        ['.yuzi-qq-dialog-menu', '--yuzi-qq-dialog-menu-radius'],
        ['.yuzi-qq-settings-view', '--yuzi-qq-settings-page'],
        ['.yuzi-qq-settings-sheet', '--yuzi-qq-settings-root-group-radius'],
        ['.yuzi-qq-dialog', '--yuzi-qq-dialog-surface'],
        ['.yuzi-qq-overlay', '--yuzi-qq-overlay'],
    ];
    for (const [selector, token] of selectorTokenPairs) {
        assertRuleUses(css, selector, token, selector + ' Figma mapping');
    }
    assertRuleDeclaration(css, '.yuzi-qq-tool-bar', 'gap', '--yuzi-qq-tool-interval', 'Figma tool bar');

    const productionMarker = 'Figma 02 production layer';
    const productionIndex = css.lastIndexOf(productionMarker);
    assert.ok(productionIndex >= 0, 'QQ CSS must contain an explicit Figma 02 production layer');
    const productionCss = css.slice(productionIndex).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(
        productionCss,
        /--yuzi-qq-tool-gap/,
        'Tool-only spacing must not leak into other production QQ selectors',
    );
    const intervalMatches = productionCss.match(/--yuzi-qq-tool-interval/g) || [];
    assert.equal(intervalMatches.length, 1, 'The measured 40px tool interval may be consumed only by the tool bar');
    assert.doesNotMatch(
        productionCss,
        /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b\d+(?:\.\d+)?(?:px|rem|em|ms|s)\b/i,
        'QQ production CSS must consume role tokens instead of raw visual literals',
    );
    assert.doesNotMatch(
        app + '\\n' + css,
        /figma\.com|node-id=|407:641|407:1786|codex-clipboard/i,
        'Figma reference raster assets must not be embedded in production QQ UI',
    );

    for (const token of [
        '--yuzi-qq-surface', '--yuzi-qq-dialog-surface', '--yuzi-qq-bubble-self', '--yuzi-qq-nav-height',
        '--yuzi-qq-settings-root-group-radius', '--yuzi-qq-tool-interval',
    ]) {
        assert.match(variables, new RegExp(escapeRegExp(token)), 'Variable documentation must mention ' + token);
    }
    for (const figmaNodeId of [
        '96:225', '233:430',
        '195:3310', '233:466', '195:3402', '233:558', '195:3334', '233:490', '195:3311', '233:467',
        '131:2570', '276:957',
        '130:2095', '233:732', '130:2096', '233:735', '130:2110', '233:746', '130:2211', '233:792',
        '177:1383', '233:1072', '177:1529', '233:1118', '177:1804', '233:1167', '177:1183', '233:1201',
        '130:2411', '233:1222', '131:2415', '233:1226',
        '279:4682', '276:1218', '279:4753', '279:4926', '278:1533', '279:5019',
        '407:641', '407:1786',
    ]) {
        assert.match(variables, new RegExp(escapeRegExp(figmaNodeId)), 'Variable documentation must map Figma node ' + figmaNodeId);
    }
    assert.match(variables, /不作为生产图片嵌入/, 'Figma reference rasters must be documentation-only');
    assert.match(variables, /Home Indicator.*外壳/, 'Phone shell ownership of Home Indicator must be documented');
    assert.match(variables, /QQ 不建立自己的主题开关/, 'QQ theme ownership must be documented');
    assert.match(variables, /当前用户头像.*--yuzi-qq-accent.*--yuzi-qq-on-accent/s,
        'the current-user avatar role must be documented');
    assert.match(variables, /人物占位头像.*--yuzi-qq-avatar-surface.*--yuzi-qq-avatar-ink/s,
        'the person placeholder avatar role must be documented');
}

try {
    main();
    console.log('[qq-figma-ui-contract] passed');
} catch (error) {
    console.error('[qq-figma-ui-contract] failed');
    console.error(error);
    process.exitCode = 1;
}
