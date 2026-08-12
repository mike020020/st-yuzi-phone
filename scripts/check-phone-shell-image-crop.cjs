const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const CROP_TOKEN_NAMES = [
    '--yuzi-phone-crop-overlay-hidden-opacity',
    '--yuzi-phone-crop-overlay-visible-opacity',
    '--yuzi-phone-crop-transition-timing',
    '--yuzi-phone-crop-dialog-inline-size',
    '--yuzi-phone-crop-dialog-compact-inline-size',
    '--yuzi-phone-crop-stage-min-height',
    '--yuzi-phone-crop-stage-compact-min-height',
    '--yuzi-phone-crop-image-max-height',
    '--yuzi-phone-crop-box-overlay-shadow',
    '--yuzi-phone-crop-grid-first-line-position',
    '--yuzi-phone-crop-grid-second-line-position',
    '--yuzi-phone-crop-handle-size',
    '--yuzi-phone-crop-handle-compact-size',
    '--yuzi-phone-crop-action-z-index',
    '--yuzi-phone-settings-home-quick-select-min-width',
    '--yuzi-phone-settings-home-quick-select-max-width',
];

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

class FakeHost {
    constructor() {
        this.children = [];
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
    }

    get firstChild() {
        return this.children[0] || null;
    }
}

async function main() {
    const imageCropCss = fs.readFileSync(path.join(ROOT, 'styles/phone-base/08-image-crop.css'), 'utf8');
    const phoneTokens = fs.readFileSync(path.join(ROOT, 'styles/phone-base/00-phone-tokens.css'), 'utf8');
    const variables = fs.readFileSync(path.join(ROOT, 'docs/phone-ui-variables.md'), 'utf8');
    const cssWithoutMediaPrelude = imageCropCss.replace(/@media[^\{]+\{/g, '@media {');

    CROP_TOKEN_NAMES.forEach((token) => {
        assert.match(phoneTokens, new RegExp(`${token}:`), `crop token ${token} must be registered`);
        assert.match(variables, new RegExp(token), `crop token ${token} must be documented`);
        assert.match(imageCropCss, new RegExp(`var\\(${token}\\)`), `crop stylesheet must consume ${token}`);
    });
    assert.doesNotMatch(
        cssWithoutMediaPrelude,
        /#[0-9a-f]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|rem|em|ms|s)\b/i,
        'crop component rules must not scatter raw visual literals; media-query thresholds are a CSS grammar exception',
    );

    const layers = await import(toModuleUrl('modules/phone-core/shell-temporary-layer-host.js'));
    const crop = await import(toModuleUrl('modules/settings-app/services/media-upload/crop.js'));
    const host = new FakeHost();
    const overlay = { parentNode: null };
    let closed = 0;

    layers.registerPhoneTemporaryLayerHost(host);
    const dispose = crop.mountPhoneImageCropOverlay(overlay, () => {
        closed += 1;
    });

    assert.equal(typeof dispose, 'function', '裁剪层获得可释放的壳内挂载');
    assert.equal(host.children.length, 1, '裁剪层挂载到手机壳内宿主');

    layers.clearPhoneTemporaryLayers();
    assert.equal(host.children.length, 0, '清理手机壳临时层时移除裁剪层');
    assert.equal(closed, 1, '清理手机壳临时层时关闭裁剪会话');

    dispose();
    const replacementOverlay = { parentNode: null };
    const replacementHost = new FakeHost();
    let replacementClosed = 0;
    crop.mountPhoneImageCropOverlay(replacementOverlay, () => {
        replacementClosed += 1;
    });
    assert.equal(host.children.length, 1, '重开裁剪会话仍挂载到当前手机壳宿主');

    layers.registerPhoneTemporaryLayerHost(replacementHost);
    assert.equal(host.children.length, 0, '手机壳重新初始化时移除旧宿主中的裁剪层');
    assert.equal(replacementClosed, 1, '手机壳重新初始化时仅关闭一次旧裁剪会话');

    layers.resetPhoneTemporaryLayerHost();
    assert.equal(crop.mountPhoneImageCropOverlay({ parentNode: null }), null, '不存在手机壳宿主时拒绝挂载裁剪层');
    console.log('[phone-shell-image-crop-check] 检查通过');
}

main().catch((error) => {
    console.error('[phone-shell-image-crop-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
