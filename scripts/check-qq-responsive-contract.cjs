const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function finalDeclaration(source, name) {
    const pattern = new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`, 'g');
    let match;
    let value = '';
    while ((match = pattern.exec(source))) value = match[1].trim();
    return value;
}

function finalRuleDeclaration(source, selector, property) {
    const cleanSource = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    const declarationPattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`, 'g');
    let ruleMatch;
    let value = '';

    while ((ruleMatch = rulePattern.exec(cleanSource))) {
        const selectors = ruleMatch[1].split(',').map((item) => item.trim());
        if (!selectors.includes(selector)) continue;

        let declarationMatch;
        while ((declarationMatch = declarationPattern.exec(ruleMatch[2]))) {
            value = declarationMatch[1].trim();
        }
        declarationPattern.lastIndex = 0;
    }

    return value;
}

async function main() {
    const resize = read('modules/window/resize.js');
    const app = read('modules/qq-v2/ui/app.js');
    const tokens = read('styles/phone-base/00-phone-tokens.css');
    const css = read('styles/phone-base/12-qq-app.css');

    assert.match(resize, /new CustomEvent\('yuzi-phone-resize-start'/, 'manual phone resizing must notify active apps');
    assert.match(app, /addEventListener\('yuzi-phone-resize-start'/, 'QQ must respond to manual phone resizing');
    assert.match(app, /drafts\.clear\(\)/, 'QQ must discard unsubmitted drafts when manual resizing starts');
    assert.match(app, /emojiOpen = false/, 'QQ must close the emoji panel when manual resizing starts');
    assert.match(app, /removeEventListener\('yuzi-phone-resize-start'/, 'QQ must clean up its shell resize listener');

    for (const className of [
        'yuzi-qq-message-root-view',
        'yuzi-qq-contact-root-view',
        'yuzi-qq-assistant-root-view',
        'yuzi-qq-settings-root-view',
    ]) {
        assert.match(
            app,
            new RegExp(`createElement\\('main',\\s*'[^']*yuzi-qq-view[^']*${className}[^']*'\\)`),
            `${className} must inherit the shared responsive QQ view`,
        );
    }

    assert.equal(finalDeclaration(tokens, '--yuzi-qq-max-content-width'), '100%',
        'the Figma screen width is a reference size, not a production content cap');
    assert.equal(finalDeclaration(tokens, '--yuzi-qq-settings-root-group-width'), '100%',
        'the settings root group must fill the available padded width');

    for (const [property, value] of [
        ['inline-size', '100%'],
        ['min-inline-size', '0'],
        ['max-inline-size', 'none'],
        ['block-size', '100%'],
        ['overflow', 'hidden'],
    ]) {
        assert.equal(finalRuleDeclaration(css, '.yuzi-qq-viewport', property), value,
            `.yuzi-qq-viewport ${property} must resolve to ${value}`);
    }

    for (const [property, value] of [
        ['flex', '1 1 auto'],
        ['inline-size', '100%'],
        ['min-inline-size', '0'],
        ['max-inline-size', 'none'],
        ['margin-inline', '0'],
        ['min-block-size', '0'],
        ['overflow', 'auto'],
    ]) {
        assert.equal(finalRuleDeclaration(css, '.yuzi-qq-view', property), value,
            `.yuzi-qq-view ${property} must resolve to ${value}`);
    }

    for (const [property, value] of [
        ['inline-size', '100%'],
        ['max-inline-size', 'none'],
        ['padding-inline', 'var(--yuzi-qq-nav-padding-inline)'],
        ['justify-content', 'flex-start'],
        ['overflow-x', 'auto'],
    ]) {
        assert.equal(finalRuleDeclaration(css, '.yuzi-qq-nav', property), value,
            `.yuzi-qq-nav ${property} must resolve to ${value}`);
    }

    for (const [property, value] of [
        ['flex', '1 1 var(--yuzi-qq-nav-item-width)'],
        ['min-inline-size', 'var(--yuzi-qq-touch-size)'],
        ['max-inline-size', 'none'],
    ]) {
        assert.equal(finalRuleDeclaration(css, '.yuzi-qq-nav-item', property), value,
            `.yuzi-qq-nav-item ${property} must resolve to ${value}`);
    }

    assert.equal(finalRuleDeclaration(css, '.yuzi-qq-settings-root-sheet', 'inline-size'), '100%',
        'the root settings sheet must shrink with the current reading column');
    assert.equal(
        finalRuleDeclaration(css, '.yuzi-qq-settings-root-sheet', 'max-inline-size'),
        'var(--yuzi-qq-settings-root-group-width)',
        'the root settings sheet must consume the fluid group width token',
    );
    assert.equal(finalRuleDeclaration(css, '.yuzi-qq-settings-root-sheet', 'margin-inline'), '0',
        'the root settings sheet must not remain centered inside a narrower column');

    for (const selector of [
        '.yuzi-qq-message-root-view',
        '.yuzi-qq-contact-root-view',
        '.yuzi-qq-assistant-root-view',
        '.yuzi-qq-settings-root-view',
    ]) {
        const maxInlineSize = finalRuleDeclaration(css, selector, 'max-inline-size');
        assert.ok(
            ['', 'none', '100%'].includes(maxInlineSize),
            `${selector} must not restore the 402px Figma reference as a content cap`,
        );
    }
    assert.doesNotMatch(css, /flex:\s*0 0 var\(--yuzi-qq-nav-item-width\)/,
        'a later Figma rule must not lock root navigation items to 82px');
    assert.doesNotMatch(css, /min-inline-size:\s*var\(--yuzi-qq-nav-item-width\)/,
        'a later Figma rule must not prevent root navigation items from shrinking');

    console.log('[qq-responsive-contract] passed');
}

main().catch((error) => {
    console.error('[qq-responsive-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
