const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function main() {
    const source = read('modules/qq-v2/ui/app.js');

    assert.match(source, /conversation\.remark/, 'conversation detail must expose the private-chat remark');
    assert.match(source, /data-qq-conversation-detail-form/, 'conversation detail must use its own editable form');
    assert.match(source, /profile:\s*\{\s*remark:/, 'remark saves through the existing private-profile Facade intent');
    assert.match(source, /followGlobal/, 'conversation detail must expose the global-follow policy');
    assert.match(source, /injection:\s*\{[\s\S]{0,700}light:[\s\S]{0,700}depth:/, 'local injection saves light and depth through the Facade');
    assert.match(source, /settings\.worldbook(?:\?\.)?\.light/, 'global worldbook settings must expose the existing light setting');
    assert.match(source, /settings\.worldbook(?:\?\.)?\.depth/, 'global worldbook settings must expose the existing depth setting');

    console.log('[qq-conversation-detail-settings-contract] passed');
}

main().catch((error) => {
    console.error('[qq-conversation-detail-settings-contract] failed');
    console.error(error);
    process.exitCode = 1;
});
