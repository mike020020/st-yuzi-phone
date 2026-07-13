import { getPhoneSettings, savePhoneSettingsPatch } from '../settings.js';
import {
    BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL,
    BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC,
    BEAUTIFY_SOURCE_MODE_BUILTIN,
    BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC,
    BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL,
    PHONE_BEAUTIFY_STORE_KEY,
    PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
    PHONE_TEMPLATE_TYPE_GENERIC,
    PHONE_TEMPLATE_TYPE_SPECIAL,
} from './constants.js';
import { nowTs } from './core.js';
import { invalidatePhoneBeautifyTemplateCache } from './cache.js';
import { readTemplateStore } from './store.js';
import { getBeautifyTemplateSourceModeRuntime } from './repository.js';
import { detectGenericTemplateForTable, detectSpecialTemplateForTable } from './matcher.js';

export const BEAUTIFY_RESTORE_DEFAULTS_OK = 'BEAUTIFY_RESTORE_DEFAULTS_OK';
export const BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED = 'BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED';
export const BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED = 'BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED';
export const BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR = 'BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR';

const DEFAULT_SPECIAL_TEMPLATE_ID = 'builtin.special.message.v1';
const DEFAULT_GENERIC_TEMPLATE_ID = 'builtin.generic.table.v1';
const DEFAULT_SPECIAL_ACTIVE_MAP = Object.freeze({ special_message: DEFAULT_SPECIAL_TEMPLATE_ID });

function hasExactSpecialActiveMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return keys.length === 1
        && keys[0] === 'special_message'
        && value.special_message === DEFAULT_SPECIAL_TEMPLATE_ID;
}

function hasOnlyTemplate(runtime, expectedId) {
    const templates = Array.isArray(runtime?.templates) ? runtime.templates : [];
    return runtime?.preferredMode === BEAUTIFY_SOURCE_MODE_BUILTIN
        && templates.length === 1
        && templates[0]?.id === expectedId
        && templates[0]?.source === 'builtin';
}

function verifyRestoredDefaults() {
    const settings = getPhoneSettings() || {};
    const store = readTemplateStore();
    const specialRuntime = getBeautifyTemplateSourceModeRuntime(PHONE_TEMPLATE_TYPE_SPECIAL, { enabledOnly: true });
    const genericRuntime = getBeautifyTemplateSourceModeRuntime(PHONE_TEMPLATE_TYPE_GENERIC, { enabledOnly: true });
    const specialMatch = detectSpecialTemplateForTable({
        sheetKey: '__beautify_reset_special__',
        tableName: '消息记录表',
        headers: ['会话ID', '发送者', '消息内容'],
    });
    const genericMatch = detectGenericTemplateForTable({
        sheetKey: '__beautify_reset_generic__',
        tableName: '恢复默认验证表',
        headers: [],
    });

    const checks = {
        storeTemplatesEmpty: Array.isArray(store.templates) && store.templates.length === 0,
        storeBindingsEmpty: !!store.bindings && Object.keys(store.bindings).length === 0,
        specialSourceBuiltin: settings[BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL] === BEAUTIFY_SOURCE_MODE_BUILTIN,
        genericSourceBuiltin: settings[BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC] === BEAUTIFY_SOURCE_MODE_BUILTIN,
        specialActiveExact: hasExactSpecialActiveMap(settings[BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL]),
        genericActiveExact: settings[BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC] === DEFAULT_GENERIC_TEMPLATE_ID,
        specialRuntimeBuiltin: hasOnlyTemplate(specialRuntime, DEFAULT_SPECIAL_TEMPLATE_ID),
        genericRuntimeBuiltin: hasOnlyTemplate(genericRuntime, DEFAULT_GENERIC_TEMPLATE_ID),
        specialMatcherBuiltin: specialMatch?.template?.id === DEFAULT_SPECIAL_TEMPLATE_ID,
        genericMatcherBuiltin: genericMatch?.template?.id === DEFAULT_GENERIC_TEMPLATE_ID,
    };

    return { ok: Object.values(checks).every(Boolean), checks };
}

export function restorePhoneBeautifyTemplatesToBuiltinDefaults() {
    try {
        const written = savePhoneSettingsPatch({
            [PHONE_BEAUTIFY_STORE_KEY]: {
                schemaVersion: PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
                updatedAt: nowTs(),
                templates: [],
                bindings: {},
            },
            [BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL]: BEAUTIFY_SOURCE_MODE_BUILTIN,
            [BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC]: BEAUTIFY_SOURCE_MODE_BUILTIN,
            [BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL]: { ...DEFAULT_SPECIAL_ACTIVE_MAP },
            [BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC]: DEFAULT_GENERIC_TEMPLATE_ID,
        });

        if (!written) {
            return { success: false, code: BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED, message: '恢复默认写入失败，请重试' };
        }

        invalidatePhoneBeautifyTemplateCache();
        const verification = verifyRestoredDefaults();
        if (!verification.ok) {
            return { success: false, code: BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED, message: '恢复默认校验失败，请重试', verification };
        }

        return { success: true, code: BEAUTIFY_RESTORE_DEFAULTS_OK, message: '已恢复默认', verification };
    } catch (error) {
        return {
            success: false,
            code: BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR,
            message: `恢复默认失败：${error?.message || '未知错误'}`,
        };
    }
}
