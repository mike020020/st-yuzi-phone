import { getPhoneSettings, savePhoneSetting } from '../settings.js';
import {
    BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL,
    BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC,
    BEAUTIFY_SOURCE_MODE_BUILTIN,
    BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL,
    BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC,
    BEAUTIFY_SOURCE_MODE_USER,
    PHONE_TEMPLATE_TYPE_SPECIAL,
    PHONE_TEMPLATE_TYPE_GENERIC,
    SPECIAL_RENDERER_KEYS,
} from './constants.js';
import {
    normalizeString,
    sanitizeId,
} from './core.js';
import {
    normalizeTemplate,
    normalizeTemplateType,
} from './normalize.js';
import { createBeautifyUserTemplateWriteDisabledResult } from './policy.js';
import {
    getCachedAllPhoneBeautifyTemplates,
    getCachedBeautifyTemplateSourceRuntime,
    getCachedBuiltinPhoneBeautifyTemplates,
    getCachedPhoneBeautifyTemplatesByType,
    getCachedPhoneBeautifyTemplateStore,
    getPhoneBeautifyTemplateCacheVersion,
    invalidatePhoneBeautifyTemplateCache,
} from './cache.js';

const ALLOWED_TEMPLATE_TYPES = new Set([
    PHONE_TEMPLATE_TYPE_SPECIAL,
    PHONE_TEMPLATE_TYPE_GENERIC,
]);

const ALLOWED_RENDERER_KEYS = new Set([
    ...SPECIAL_RENDERER_KEYS,
    'generic_table',
]);

function buildSourceRuntimeCacheKey(templateType, options = {}) {
    const safeType = normalizeTemplateType(templateType, '');
    const settings = getPhoneSettings() || {};
    const enabledOnly = options.enabledOnly === true ? 'enabled' : 'all';
    const storeVersion = getPhoneBeautifyTemplateCacheVersion();

    if (safeType === PHONE_TEMPLATE_TYPE_SPECIAL) {
        const rawMap = settings?.[BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL];
        const sortedMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)
            ? Object.entries(rawMap)
                .filter(([key, value]) => !!key && !!value)
                .sort(([a], [b]) => String(a).localeCompare(String(b)))
            : [];

        return JSON.stringify([
            safeType,
            enabledOnly,
            String(settings?.[BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL] || ''),
            sortedMap,
            storeVersion,
        ]);
    }

    return JSON.stringify([
        safeType,
        enabledOnly,
        String(settings?.[BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC] || ''),
        String(settings?.[BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC] || ''),
        storeVersion,
    ]);
}

function normalizeBeautifySourceMode(rawMode, fallback = BEAUTIFY_SOURCE_MODE_BUILTIN) {
    const mode = normalizeString(rawMode, 24).toLowerCase();
    if (mode === BEAUTIFY_SOURCE_MODE_BUILTIN || mode === BEAUTIFY_SOURCE_MODE_USER) {
        return mode;
    }
    return fallback === BEAUTIFY_SOURCE_MODE_USER ? BEAUTIFY_SOURCE_MODE_USER : BEAUTIFY_SOURCE_MODE_BUILTIN;
}

function normalizeSourceModeForTemplateType(templateType, sourceMode) {
    const safeType = normalizeTemplateType(templateType, '');
    if (!safeType) return BEAUTIFY_SOURCE_MODE_BUILTIN;

    if (safeType === PHONE_TEMPLATE_TYPE_SPECIAL || safeType === PHONE_TEMPLATE_TYPE_GENERIC) {
        return normalizeBeautifySourceMode(sourceMode, BEAUTIFY_SOURCE_MODE_BUILTIN);
    }

    return BEAUTIFY_SOURCE_MODE_BUILTIN;
}

function getSourceModeSettingKey(templateType) {
    const safeType = normalizeTemplateType(templateType, '');
    if (safeType === PHONE_TEMPLATE_TYPE_SPECIAL) return BEAUTIFY_SOURCE_MODE_SETTING_KEY_SPECIAL;
    if (safeType === PHONE_TEMPLATE_TYPE_GENERIC) return BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC;
    return '';
}

function saveBeautifyTemplateSettingAndInvalidate(settingKey, value) {
    savePhoneSetting(settingKey, value);
    invalidatePhoneBeautifyTemplateCache();
}

function normalizeSpecialActiveTemplateIds(rawMap) {
    const src = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)
        ? rawMap
        : {};

    const normalized = {};
    Object.entries(src).forEach(([rendererKey, templateId]) => {
        const safeRendererKey = normalizeString(rendererKey, 48);
        if (!SPECIAL_RENDERER_KEYS.has(safeRendererKey)) return;

        const safeTemplateId = sanitizeId(templateId, '');
        if (!safeTemplateId) return;

        normalized[safeRendererKey] = safeTemplateId;
    });

    return normalized;
}

function normalizeGenericActiveTemplateId(rawTemplateId) {
    return sanitizeId(rawTemplateId, '');
}

function getSpecialActiveTemplateIdsRaw() {
    const raw = getPhoneSettings()?.[BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL];
    return normalizeSpecialActiveTemplateIds(raw);
}

function getGenericActiveTemplateIdRaw() {
    const raw = getPhoneSettings()?.[BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC];
    return normalizeGenericActiveTemplateId(raw);
}

function areSpecialActiveTemplateIdsEqual(leftMap, rightMap) {
    const left = normalizeSpecialActiveTemplateIds(leftMap);
    const right = normalizeSpecialActiveTemplateIds(rightMap);
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}


function getSpecialTemplatesByRendererKey(rendererKey, options = {}) {
    const safeRendererKey = normalizeString(rendererKey, 48);
    if (!SPECIAL_RENDERER_KEYS.has(safeRendererKey)) return [];

    return getPhoneBeautifyTemplatesByType(PHONE_TEMPLATE_TYPE_SPECIAL, {
        includeBuiltin: options.includeBuiltin !== false,
        includeUser: options.includeUser !== false,
        enabledOnly: options.enabledOnly === true,
    }).filter(t => t?.render?.rendererKey === safeRendererKey);
}

function getDefaultSpecialTemplateIdByRenderer(rendererKey) {
    const candidates = getSpecialTemplatesByRendererKey(rendererKey, {
        includeBuiltin: true,
        includeUser: false,
        enabledOnly: true,
    });
    return sanitizeId(candidates[0]?.id, '');
}

function getDefaultGenericTemplateId() {
    const templates = getPhoneBeautifyTemplatesByType(PHONE_TEMPLATE_TYPE_GENERIC, {
        includeBuiltin: true,
        includeUser: false,
        enabledOnly: true,
    }).filter(t => t?.render?.rendererKey === 'generic_table');

    return sanitizeId(templates[0]?.id, '');
}

function ensureValidSpecialActiveTemplateIds(rawMap) {
    const normalized = normalizeSpecialActiveTemplateIds(rawMap);
    const result = { ...normalized };

    SPECIAL_RENDERER_KEYS.forEach((rendererKey) => {
        const currentId = sanitizeId(result[rendererKey], '');
        if (!currentId) return;

        const exists = getSpecialTemplatesByRendererKey(rendererKey, {
            includeBuiltin: true,
            includeUser: true,
            enabledOnly: true,
        }).some(t => t.id === currentId);

        if (!exists) {
            delete result[rendererKey];
        }
    });

    return result;
}

function ensureValidGenericActiveTemplateId(rawTemplateId) {
    const id = normalizeGenericActiveTemplateId(rawTemplateId);
    if (!id) return '';

    const exists = getPhoneBeautifyTemplatesByType(PHONE_TEMPLATE_TYPE_GENERIC, {
        includeBuiltin: true,
        includeUser: true,
        enabledOnly: true,
    }).some(t => t.id === id && t?.render?.rendererKey === 'generic_table');

    return exists ? id : '';
}

function getEffectiveTemplatesBySourceMode(templates, sourceMode) {
    const safeTemplates = Array.isArray(templates) ? templates : [];
    const mode = normalizeBeautifySourceMode(sourceMode, BEAUTIFY_SOURCE_MODE_BUILTIN);

    const builtin = safeTemplates.filter(t => t?.source === 'builtin');
    const user = safeTemplates.filter(t => t?.source !== 'builtin');

    if (mode === BEAUTIFY_SOURCE_MODE_USER) {
        if (user.length > 0) {
            return {
                templates: user,
                fallbackApplied: false,
                mode: BEAUTIFY_SOURCE_MODE_USER,
            };
        }

        return {
            templates: builtin,
            fallbackApplied: true,
            mode: BEAUTIFY_SOURCE_MODE_BUILTIN,
        };
    }

    return {
        templates: builtin,
        fallbackApplied: false,
        mode: BEAUTIFY_SOURCE_MODE_BUILTIN,
    };
}

export function getBeautifyTemplateSourceMode(templateType) {
    const settingKey = getSourceModeSettingKey(templateType);
    if (!settingKey) return BEAUTIFY_SOURCE_MODE_BUILTIN;

    const raw = getPhoneSettings()?.[settingKey];
    return normalizeSourceModeForTemplateType(templateType, raw);
}

export function setBeautifyTemplateSourceMode(templateType, sourceMode) {
    void templateType;
    void sourceMode;
    return createBeautifyUserTemplateWriteDisabledResult();
}

export function getActiveBeautifyTemplateIdByType(templateType, options = {}) {
    const safeType = normalizeTemplateType(templateType, '');
    if (!safeType) return '';

    if (safeType === PHONE_TEMPLATE_TYPE_GENERIC) {
        const valid = ensureValidGenericActiveTemplateId(getGenericActiveTemplateIdRaw());
        if (valid) return valid;

        return options.withFallback === false ? '' : getDefaultGenericTemplateId();
    }

    return '';
}

export function getActiveBeautifyTemplateIdsForSpecial(options = {}) {
    const valid = ensureValidSpecialActiveTemplateIds(getSpecialActiveTemplateIdsRaw());
    const withFallback = options.withFallback !== false;

    if (!withFallback) return valid;

    const merged = { ...valid };

    SPECIAL_RENDERER_KEYS.forEach((rendererKey) => {
        if (merged[rendererKey]) return;
        const fallbackId = getDefaultSpecialTemplateIdByRenderer(rendererKey);
        if (!fallbackId) return;
        merged[rendererKey] = fallbackId;
    });

    return merged;
}

export function repairActiveBeautifyTemplateSettings() {
    const result = {
        genericUpdated: false,
        specialUpdated: false,
        genericActiveTemplateId: '',
        specialActiveTemplateIds: {},
    };

    const rawGenericId = getGenericActiveTemplateIdRaw();
    const validGenericId = ensureValidGenericActiveTemplateId(rawGenericId);
    const nextGenericId = validGenericId || getDefaultGenericTemplateId();
    result.genericActiveTemplateId = nextGenericId;

    if (rawGenericId !== nextGenericId) {
        saveBeautifyTemplateSettingAndInvalidate(BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC, nextGenericId);
        result.genericUpdated = true;
    }

    const rawSpecialMap = getSpecialActiveTemplateIdsRaw();
    const nextSpecialMap = getActiveBeautifyTemplateIdsForSpecial({
        withFallback: true,
        persist: false,
    });
    result.specialActiveTemplateIds = nextSpecialMap;

    if (!areSpecialActiveTemplateIdsEqual(rawSpecialMap, nextSpecialMap)) {
        saveBeautifyTemplateSettingAndInvalidate(BEAUTIFY_ACTIVE_TEMPLATE_IDS_SETTING_KEY_SPECIAL, nextSpecialMap);
        result.specialUpdated = true;
    }

    return result;
}

export function setActiveBeautifyTemplateIdByType(templateType, templateId) {
    void templateType;
    void templateId;
    return createBeautifyUserTemplateWriteDisabledResult();
}

export function getBeautifyTemplateSourceModeRuntime(templateType, options = {}) {
    return getCachedBeautifyTemplateSourceRuntime(
        buildSourceRuntimeCacheKey(templateType, options),
        () => {
            const mode = getBeautifyTemplateSourceMode(templateType);
            const templates = getPhoneBeautifyTemplatesByType(templateType, {
                includeBuiltin: true,
                includeUser: true,
                enabledOnly: options.enabledOnly === true,
            });

            const safeType = normalizeTemplateType(templateType, '');

            if (safeType === PHONE_TEMPLATE_TYPE_SPECIAL) {
                const activeMap = getActiveBeautifyTemplateIdsForSpecial({
                    withFallback: true,
                    persist: false,
                });
                const selected = templates.filter((t) => {
                    const rendererKey = normalizeString(t?.render?.rendererKey, 48);
                    if (!SPECIAL_RENDERER_KEYS.has(rendererKey)) return false;
                    return sanitizeId(activeMap[rendererKey], '') === t.id;
                });

                if (selected.length > 0) {
                    return {
                        preferredMode: mode,
                        effectiveMode: 'active_template',
                        fallbackApplied: false,
                        hasUserTemplates: templates.some(t => t?.source !== 'builtin'),
                        templates: selected,
                    };
                }
            }

            if (safeType === PHONE_TEMPLATE_TYPE_GENERIC) {
                const activeTemplateId = getActiveBeautifyTemplateIdByType(PHONE_TEMPLATE_TYPE_GENERIC, {
                    withFallback: true,
                    persist: false,
                });

                const selected = activeTemplateId
                    ? templates.filter(t => t.id === activeTemplateId && t?.render?.rendererKey === 'generic_table')
                    : [];

                if (selected.length > 0) {
                    return {
                        preferredMode: mode,
                        effectiveMode: 'active_template',
                        fallbackApplied: false,
                        hasUserTemplates: templates.some(t => t?.source !== 'builtin'),
                        templates: selected,
                    };
                }
            }

            const filtered = getEffectiveTemplatesBySourceMode(templates, mode);
            return {
                preferredMode: mode,
                effectiveMode: filtered.mode,
                fallbackApplied: filtered.fallbackApplied,
                hasUserTemplates: templates.some(t => t?.source !== 'builtin'),
                templates: filtered.templates,
            };
        },
    );
}

export function getBuiltinPhoneBeautifyTemplates() {
    return getCachedBuiltinPhoneBeautifyTemplates();
}

export function getPhoneBeautifyTemplateStore() {
    return getCachedPhoneBeautifyTemplateStore();
}

export function getAllPhoneBeautifyTemplates(options = {}) {
    return getCachedAllPhoneBeautifyTemplates(options);
}

export function getPhoneBeautifyTemplatesByType(templateType, options = {}) {
    return getCachedPhoneBeautifyTemplatesByType(templateType, options);
}

export function validatePhoneBeautifyTemplate(rawTemplate) {
    const errors = [];
    const warnings = [];

    const normalized = normalizeTemplate(rawTemplate, {
        sourceFallback: 'user',
    });

    if (!normalized) {
        errors.push('模板不是有效对象');
        return { ok: false, errors, warnings, template: null };
    }

    if (!normalized.id) {
        errors.push('模板缺少 id');
    }

    if (!normalized.name) {
        errors.push('模板缺少 name');
    }

    if (!ALLOWED_TEMPLATE_TYPES.has(normalized.templateType)) {
        errors.push(`不支持的 templateType：${normalized.templateType}`);
    }

    if (!ALLOWED_RENDERER_KEYS.has(normalized.render?.rendererKey)) {
        errors.push(`不支持的 rendererKey：${normalized.render?.rendererKey || ''}`);
    }

    if (normalized.templateType === PHONE_TEMPLATE_TYPE_SPECIAL) {
        const rendererKey = normalizeString(normalized.render?.rendererKey, 48);
        if (!SPECIAL_RENDERER_KEYS.has(rendererKey)) {
            errors.push('专属模板的 rendererKey 必须是 special_message');
        }
    }

    if ((normalized.matcher?.requiredHeaders || []).length === 0
        && (normalized.matcher?.tableNameExact || []).length === 0
        && (normalized.matcher?.tableNameIncludes || []).length === 0) {
        warnings.push('模板未配置明显匹配特征，可能无法稳定识别');
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        template: normalized,
    };
}

export function savePhoneBeautifyUserTemplate(rawTemplate, options = {}) {
    void rawTemplate;
    void options;
    return createBeautifyUserTemplateWriteDisabledResult({ warnings: [], errors: [], template: null });
}

export function deletePhoneBeautifyUserTemplate(templateId) {
    void templateId;
    return createBeautifyUserTemplateWriteDisabledResult();
}
