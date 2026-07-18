import { CONTENT_PRESET_FORMAT, CONTENT_PRESET_FORMAT_VERSION } from './constants.js';

export function isContentPresetBundle(value) {
    return !!value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.format === CONTENT_PRESET_FORMAT
        && Number(value.formatVersion) === CONTENT_PRESET_FORMAT_VERSION
        && value.manifest
        && typeof value.manifest === 'object'
        && !Array.isArray(value.manifest)
        && value.files
        && typeof value.files === 'object'
        && !Array.isArray(value.files);
}

export function parseContentPresetBundle(input) {
    let value = input;
    if (typeof input === 'string') {
        try {
            value = JSON.parse(input);
        } catch (error) {
            throw new Error(`玉子美化预设不是有效 JSON：${error.message}`);
        }
    }
    if (!isContentPresetBundle(value)) {
        throw new Error(`不支持的玉子美化预设格式，需要 ${CONTENT_PRESET_FORMAT}@${CONTENT_PRESET_FORMAT_VERSION}`);
    }
    return value;
}
