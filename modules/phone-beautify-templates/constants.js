export const PHONE_TEMPLATE_TYPE_GENERIC = 'generic_table_template';

export const PHONE_BEAUTIFY_TEMPLATE_FORMAT = 'yuzi-phone-style-pack';
export const PHONE_BEAUTIFY_TEMPLATE_SCHEMA_VERSION = '1.3.0';
export const PHONE_BEAUTIFY_TEMPLATE_MIN_COMPAT_SCHEMA_VERSION = '1.0.0';

export const PHONE_BEAUTIFY_STORE_KEY = 'yuziPhoneBeautifyTemplates';
export const MAX_IMPORTED_TEMPLATES = 80;
export const PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_RUNTIME = 'runtime';
export const PHONE_BEAUTIFY_TEMPLATE_EXPORT_MODE_ANNOTATED = 'annotated';

export const BEAUTIFY_SOURCE_MODE_SETTING_KEY_GENERIC = 'beautifyTemplateSourceModeGeneric';
export const BEAUTIFY_SOURCE_MODE_BUILTIN = 'builtin';
export const BEAUTIFY_SOURCE_MODE_USER = 'user';
export const BEAUTIFY_SOURCE_MODE_ALLOWED = new Set([
    BEAUTIFY_SOURCE_MODE_BUILTIN,
    BEAUTIFY_SOURCE_MODE_USER,
]);

export const BEAUTIFY_ACTIVE_TEMPLATE_ID_SETTING_KEY_GENERIC = 'beautifyActiveTemplateIdGeneric';

export const DEFAULT_GENERIC_MIN_SCORE = 55;

export const ALLOWED_TEMPLATE_TYPES = new Set([
    PHONE_TEMPLATE_TYPE_GENERIC,
]);

export const ALLOWED_RENDERER_KEYS = new Set([
    'generic_table',
]);
