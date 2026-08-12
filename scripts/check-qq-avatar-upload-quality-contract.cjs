const fs = require('fs');

const source = fs.readFileSync('modules/qq-v2/ui/app.js', 'utf8');

const uploadFunctions = [
    'updatePrivateProfileAsset',
    'updateCurrentProfileAsset',
    'uploadImageLibraryAsset',
];

for (const [index, name] of uploadFunctions.entries()) {
    const start = source.indexOf(`const ${name} =`);
    const end = index + 1 < uploadFunctions.length
        ? source.indexOf(`const ${uploadFunctions[index + 1]} =`, start)
        : source.indexOf('const confirmImageLibraryDeletion =', start);
    const body = start >= 0 && end > start ? source.slice(start, end) : '';
    if (!body.includes("compress: cropPreset !== 'icon'")) {
        throw new Error(`${name} must preserve icon crops without lossy recompression`);
    }
}

console.log('[qq-avatar-upload-quality-contract] checks passed');
