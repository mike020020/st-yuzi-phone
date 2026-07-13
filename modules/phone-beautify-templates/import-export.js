import {
    PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_ANNOTATED,
    PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_RUNTIME,
    PHONE_BEAUTIFY_TEMPLATE_FORMAT,
    PHONE_BEAUTIFY_TEMPLATE_MIN_COMPAT_SCHEMA_VERSION,
    PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
} from './constants.js';
import {
    normalizeString,
    sanitizeId,
} from './core.js';
import { normalizeTemplateType } from './normalize.js';
import { serializeTemplateForExport } from './pack-helpers.js';
import {
    getAllPhoneBeautifyTemplates,
} from './repository.js';
import { createBeautifyUserTemplateWriteDisabledResult } from './policy.js';

export function exportPhoneBeautifyPack(options = {}) {
    const templateTypeRaw = normalizeString(options.templateType, 48);
    const templateType = templateTypeRaw ? normalizeTemplateType(templateTypeRaw, '') : '';

    const builtinOnly = !!options.builtinOnly;
    const userOnly = !!options.userOnly;
    const templateIdSet = Array.isArray(options.templateIds)
        ? new Set(options.templateIds.map(id => sanitizeId(id, '')).filter(Boolean))
        : null;

    const exportModeRaw = normalizeString(options.exportMode, 24).toLowerCase();
    const exportMode = exportModeRaw === PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_RUNTIME
        ? PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_RUNTIME
        : PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_ANNOTATED;

    const templates = getAllPhoneBeautifyTemplates({ includeDisabled: true })
        .filter((template) => {
            if (templateType && template.templateType !== templateType) return false;
            if (builtinOnly && template.source !== 'builtin') return false;
            if (userOnly && template.source === 'builtin') return false;
            if (templateIdSet && !templateIdSet.has(template.id)) return false;
            if (template.exportable === false) return false;
            return true;
        })
        .map((template) => serializeTemplateForExport(template, exportMode));

    return {
        success: true,
        count: templates.length,
        pack: {
            format: PHONE_BEAUTIFY_TEMPLATE_FORMAT,
            schemaVersion: PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
            packMeta: {
                name: normalizeString(options.packName, 80) || '手机美化模板包',
                exportedAt: new Date().toISOString(),
                exporter: 'YuziPhone',
                exportMode,
                schemaCompatMin: PHONE_BEAUTIFY_TEMPLATE_MIN_COMPAT_SCHEMA_VERSION,
                schemaCompatMax: PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION,
            },
            templates,
        },
    };
}

export function importPhoneBeautifyPackFromData(input, options = {}) {
    void input;
    void options;
    return createBeautifyUserTemplateWriteDisabledResult({ imported: 0, replaced: 0, skipped: 0, errors: [], warnings: [] });
}
