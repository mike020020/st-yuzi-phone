const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const source = read('modules/qq-v2/ui/app.js');
const tokens = read('styles/phone-base/00-phone-tokens.css');
const css = read('styles/phone-base/12-qq-app.css');

assert.match(tokens, /--yuzi-qq-composer-height:\s*88px;/,
    'the QQ composer excludes the shell-owned 34px Home Indicator region');
assert.match(tokens, /--yuzi-qq-private-emoji-panel-height:\s*min\(320px,\s*40%\);/,
    'the private sticker grid keeps the 320px Figma height while adapting to short phones');
assert.match(tokens, /--yuzi-qq-private-tool-slot-min:\s*44px;/,
    'private-chat tools keep a usable narrow-screen slot size');

assert.match(css, /\.yuzi-qq-private-message-stream\s*\{[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s,
    'the private message stream hides its scrollbar without disabling scrolling');
assert.match(css, /\.yuzi-qq-private-chat-tools\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(var\(--yuzi-qq-private-tool-slot-min\),\s*1fr\)\);[^}]*overflow-x:\s*auto;/s,
    'the six tools expand evenly and become horizontally scrollable only when narrow');
assert.match(css, /\.yuzi-qq-private-composer-layer\s*\{[^}]*position:\s*static;[^}]*flex:\s*0\s+0\s+var\(--yuzi-qq-composer-height\);/s,
    'the composer layer keeps a stable 88px flow footprint');
assert.match(css, /\.yuzi-qq-private-chat-composer\s*\{[^}]*position:\s*absolute;[^}]*inset-block-end:\s*0;[^}]*padding:\s*var\(--yuzi-qq-inline-gap\)\s+var\(--yuzi-qq-composer-padding-inline\)\s+0;/s,
    'the composer can rise above the overlay without resizing the message stream');
assert.match(css, /\.yuzi-qq-private-chat-view\.has-chat-background::before[\s\S]*background:\s*var\(--yuzi-qq-chat-background-image\)/,
    'chat backgrounds attach to the fixed chat viewport layer');
assert.match(css, /\.yuzi-qq-private-chat-view\.has-chat-background\s+\.yuzi-qq-message-stream::before,[\s\S]*content:\s*none;/,
    'the scrolling message stream cannot own a finite-height background layer');
assert.match(css, /\.yuzi-qq-private-emoji-panel\s*\{[^}]*position:\s*absolute;[^}]*inset-block-end:\s*0;[^}]*block-size:\s*var\(--yuzi-qq-private-emoji-panel-height\);[^}]*overflow-y:\s*auto;/s,
    'the sticker grid overlays the message area and owns its own scrolling');
assert.doesNotMatch(css, /has-emoji-panel::before|has-emoji-panel::after|composer-expanded-height/,
    'opening the sticker panel cannot shorten the fixed chat background');
assert.match(css, /\.yuzi-qq-private-chat-jump-bubble\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--yuzi-qq-accent\);/s,
    'new messages use the Figma-style circular accent bubble');

assert.match(source, /const render = async[\s\S]*?const scrollSnapshot = viewScrollState\.capture\(\);[\s\S]*?closeEmojiPanel\(\{ preserveScroll: false \}\)/,
    'rendering captures the current view before collapsing temporary layers');
assert.match(source, /const closeEmojiPanel = \(\{ preserveScroll = true \} = \{\}\) => \{[\s\S]{0,500}viewScrollState\.restore\(scrollSnapshot/,
    'in-place emoji closure preserves the stable visible-message anchor');
assert.match(source, /const handlePhoneResizeStart = \(\) => \{[\s\S]{0,320}viewScrollState\.capture\(\)[\s\S]{0,160}closeEmojiPanel\(\{ preserveScroll: false \}\)[\s\S]{0,180}viewScrollState\.restore\(/,
    'manual resize closes temporary layers while preserving the visible page anchor');
assert.match(source, /stream\.scrollTop = Math\.max\(0, stream\.scrollHeight - stream\.clientHeight\)/,
    'the numeric new-message bubble scrolls to the exact bottom');
assert.match(source, /composerLayer\.append\(composer\)[\s\S]{0,220}composerLayer\.append\(panel\)[\s\S]{0,120}main\.append\(stream, composerLayer\)/,
    'the composer and sticker panel share an overlay layer with a stable flow placeholder');
assert.match(source, /target\.dataset\.qqSticker[\s\S]{0,700}facade\.intent\.sendMessage/,
    'sticker taps retain the user-approved immediate-send contract');
assert.match(source, /jumpLabel\.textContent = formatUnreadBadge\(jumpCount\)/,
    'the new-message bubble displays the dynamic unread count');

console.log('[qq-private-chat-layout-contract] passed');
