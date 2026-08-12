import { getPhoneSettings, savePhoneSettingsPatch } from '../settings.js';
import {
    BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC,
    BEAUTIFY_SOURCE_MODE_BUILTIN,
    BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC,
    PHONE_BEAUTIFY_STORE_KEY,
    PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
    PHONE_TEMPLATE_TYPE_GENERIC,
} from './constants.js';
import { nowTs } from './core.js';
import { invalidatePhoneBeautifyTemplateCache } from './cache.js';
import { detectGenericTemplateForTable } from './matcher.js';
import { getBeautifyTemplateSourceModeRuntime } from './repository.js';
import { readTemplateStore } from './store.js';

export const BEAUTIFY_RESTORE_DEFAULTS_OK = 'BEAUTIFY_RESTORE_DEFAULTS_OK';
export const BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED = 'BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED';
export const BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED = 'BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED';
export const BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR = 'BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR';

const DEFAULT_GENERIC_TEMPLATE_ID = 'builtin.generic.table.v1';

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
    const genericRuntime = getBeautifyTemplateSourceModeRuntime(PHONE_TEMPLATE_TYPE_GENERIC, { enabledOnly: true });
    const genericMatch = detectGenericTemplateForTable({
        sheetKey: '__beautify_reset_generic__',
        tableName: '恢复默认验证表',
        headers: [],
    });

    const checks = {
        storeTemplatesEmpty: Array.isArray(store.templates) && store.templates.length === 0,
        storeBindingsEmpty: !!store.bindings && Object.keys(store.bindings).length === 0,
        genericSourceBuiltin: settings[BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC] === BEAUTIFY_SOURCE_MODE_BUILTIN,
        genericActiveExact: settings[BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC] === DEFAULT_GENERIC_TEMPLATE_ID,
        genericRuntimeBuiltin: hasOnlyTemplate(genericRuntime, DEFAULT_GENERIC_TEMPLATE_ID),
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
            [BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC]: BEAUTIFY_SOURCE_MODE_BUILTIN,
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
