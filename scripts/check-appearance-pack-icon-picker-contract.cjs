const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function testSelectionState() {
    const state = await import(pathToFileURL(path.join(
        ROOT,
        'modules/settings-app/services/appearance-settings/icon-selection-state.js',
    )).href);
    const first = 'data:image/png;base64,Zmlyc3Q=';
    const second = 'data:image/png;base64,c2Vjb25k';
    const icons = state.collectAppearancePackIcons({
        icons: [{ id: 'first', name: 'First', dataUrl: first, hash: 'hash-a' }],
        iconPool: [
            { id: 'duplicate', name: 'Duplicate', dataUrl: first, hash: 'hash-b' },
            { id: 'second', name: 'Second', dataUrl: second },
        ],
    });

    assert.deepEqual(icons.map(icon => icon.id), ['first', 'second']);

    const selected = state.buildAppIconAssignment({
        appIcons: { review: 'old' },
        appIconOrigins: { review: 'old-pack' },
    }, 'review', first, 'active-pack');
    assert.deepEqual(selected, {
        appIcons: { review: first },
        appIconOrigins: { review: 'active-pack' },
    });

    const local = state.buildAppIconAssignment(selected, 'review', second, '');
    assert.deepEqual(local, {
        appIcons: { review: second },
        appIconOrigins: {},
    });

    const cleaned = state.buildPackIconOriginCleanup({
        appIcons: { review: first, qq: second, variable: 'keep' },
        appIconOrigins: { review: 'active-pack', qq: 'other-pack' },
    }, 'active-pack');
    assert.deepEqual(cleaned, {
        appIcons: { qq: second, variable: 'keep' },
        appIconOrigins: { qq: 'other-pack' },
        removedKeys: ['review'],
    });
}

function testWiring() {
    const facade = read('modules/settings-app/services/appearance-settings.js');
    const upload = read('modules/settings-app/services/appearance-settings/icon-upload-service.js');
    const dialog = read('modules/settings-app/services/appearance-settings/icon-picker-dialog.js');
    const resourcePack = read('modules/settings-app/services/appearance-settings/resource-pack-service.js');
    const styles = read('styles/phone-base/07-settings-modern.css');

    assert.ok(facade.includes('createIconUploadService({\n    getAppearancePack: getAppearancePackImpl,'));
    assert.ok(upload.includes("const packId = String(settings?.appearanceActivePackId || '').trim();"));
    assert.ok(upload.includes('getAppearancePack(packId)'));
    assert.ok(upload.includes('collectAppearancePackIcons(result.pack)'));
    assert.ok(upload.includes("onSelect: icon => saveIconSelection(key, icon.dataUrl, source.id)"));
    assert.ok(upload.includes("saveIconSelection(key, dataUrl, '')"));
    assert.ok(upload.includes('showAppearanceIconSourceMenu({'));
    assert.ok(upload.includes('if (!source) {\n                        openLocalIconUpload(key, iconName);'));
    assert.ok(dialog.includes('mountPhoneTemporaryLayer(overlay'));
    assert.ok(dialog.includes('clearPhoneTemporaryLayers();'));
    assert.ok(resourcePack.includes('appIconOrigins: {}'));
    assert.ok(styles.includes('.phone-appearance-icon-dialog-layer'));
    assert.ok(styles.includes('.phone-appearance-pack-icon-grid'));
    assert.equal(upload.includes('search'), false);
}

async function main() {
    await testSelectionState();
    testWiring();
    console.log('[appearance-pack-icon-picker-contract-check] 检查通过');
}

main().catch((error) => {
    console.error('[appearance-pack-icon-picker-contract-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
