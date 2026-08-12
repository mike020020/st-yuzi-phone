const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(process.cwd(), 'modules/qq-v2/ui/app.js'), 'utf8');

function slice(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

const profileAssetRow = slice('const profileAssetRow =', 'const renderProfileEditorSurface =');
assert.doesNotMatch(
    profileAssetRow,
    /control\.append\(avatar\(/,
    'profile media rows must not embed an avatar preview',
);
assert.match(profileAssetRow, /yuzi-qq-profile-asset-upload/, 'profile media rows must keep an upload action');
assert.match(profileAssetRow, /yuzi-qq-profile-asset-delete/, 'profile media rows must keep a conditional delete action');

const conversationBackgroundRow = slice(
    "const backgroundRow = createElement('div'",
    "const injectionEnabled = settingField(",
);
assert.doesNotMatch(
    conversationBackgroundRow,
    /facade\.query\.mediaRender|style\.backgroundImage|has-chat-background/,
    'conversation settings must not render the selected chat background as a row preview',
);
assert.match(
    conversationBackgroundRow,
    /yuzi-qq-conversation-background-actions[\s\S]*yuzi-qq-conversation-background-upload[\s\S]*yuzi-qq-conversation-background-delete/,
    'conversation background upload and delete actions must share one action container',
);

const privateProfileUpload = slice('const updatePrivateProfileAsset =', 'const clearPrivateProfileAsset =');
assert.match(privateProfileUpload, /facade\.intent\.saveMedia\(/, 'private profile uploads must use dedicated media storage');
assert.doesNotMatch(privateProfileUpload, /saveImageLibraryAsset/, 'private profile uploads must not enter the image library');

const currentProfileUpload = slice('const updateCurrentProfileAsset =', 'const clearCurrentProfileAsset =');
assert.match(currentProfileUpload, /facade\.intent\.saveMedia\(/, 'current profile uploads must use dedicated media storage');
assert.match(currentProfileUpload, /saved\.media\?\.assetId/, 'current profile uploads must link the dedicated media asset');
assert.doesNotMatch(currentProfileUpload, /saveImageLibraryAsset/, 'current profile uploads must not enter the image library');

const libraryUpload = slice('const uploadImageLibraryAsset =', 'const confirmImageLibraryDeletion =');
assert.match(libraryUpload, /facade\.intent\.saveImageLibraryAsset\(/, 'image library uploads must keep the shared library storage path');
assert.doesNotMatch(libraryUpload, /facade\.intent\.saveMedia\(/, 'image library uploads must not use dedicated profile media storage');

console.log('[qq-profile-media-controls-contract] passed');
