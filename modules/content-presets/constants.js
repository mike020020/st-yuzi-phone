export const CONTENT_PRESET_FORMAT = 'yuzi-beautify-preset';
export const CONTENT_PRESET_FORMAT_VERSION = 2;
export const CONTENT_PRESET_API_VERSION = 1;
export const CONTENT_PRESET_DB_NAME = 'yuzi-phone-template-workshop-v2';
export const CONTENT_PRESET_DB_VERSION = 1;
export const CONTENT_PRESET_STORES = Object.freeze({ presets: 'presets', activeByTable: 'activeByTable' });
export const CONTENT_PRESET_BINDING_INDEX = 'presetId';
export const CONTENT_PRESET_UPDATE_EVENT = 'yuzi-phone-content-preset-updated';
export const RESOURCE_SUPPORT = Object.freeze({
    htmlAttributes: Object.freeze(['src', 'href', 'poster', 'srcset']),
    cssUrl: true,
    cssImport: false,
    svgExternal: false,
    moduleImports: false,
    importMetaUrl: false,
    relativeFetch: false,
});
