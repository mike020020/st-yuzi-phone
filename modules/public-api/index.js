/**
 * Yuzi Phone public API foundation.
 *
 * This module deliberately exposes capability metadata instead of leaking UI or
 * runtime modules. New public operations must be added only when implemented.
 */
export const PUBLIC_API_VERSION = '1.0.0';

export const PublicApiErrorCodes = Object.freeze({
    API_UNAVAILABLE: 'YUZI_PHONE_API_UNAVAILABLE',
    CAPABILITY_NOT_AVAILABLE: 'YUZI_PHONE_CAPABILITY_NOT_AVAILABLE',
    API_NOT_IMPLEMENTED: 'YUZI_PHONE_API_NOT_IMPLEMENTED',
});

export const PublicApiCapabilities = Object.freeze({
    VERSION: 'public-api.version',
    CAPABILITIES: 'public-api.capabilities',
    APP_REGISTER: 'app.register',
    SCENE_REGISTER: 'scene.register',
    MESSAGE_IMPORT: 'message.import',
    CONTEXT_READ: 'context.read',
    ACTION_EXECUTE: 'action.execute',
});

const API_OWNER = Symbol('yuzi-phone.public-api.owner');
const API_OWNER_MARKER = Symbol.for('st-yuzi-phone.public-api.owner');
const PUBLIC_API_PROPERTY = 'YuziPhoneAPI';

const capabilityDefinitions = Object.freeze([
    Object.freeze({ name: PublicApiCapabilities.VERSION, available: true }),
    Object.freeze({ name: PublicApiCapabilities.CAPABILITIES, available: true }),
    Object.freeze({
        name: PublicApiCapabilities.APP_REGISTER,
        available: false,
        errorCode: PublicApiErrorCodes.API_NOT_IMPLEMENTED,
    }),
    Object.freeze({
        name: PublicApiCapabilities.SCENE_REGISTER,
        available: false,
        errorCode: PublicApiErrorCodes.API_NOT_IMPLEMENTED,
    }),
    Object.freeze({
        name: PublicApiCapabilities.MESSAGE_IMPORT,
        available: false,
        errorCode: PublicApiErrorCodes.API_NOT_IMPLEMENTED,
    }),
    Object.freeze({
        name: PublicApiCapabilities.CONTEXT_READ,
        available: false,
        errorCode: PublicApiErrorCodes.API_NOT_IMPLEMENTED,
    }),
    Object.freeze({
        name: PublicApiCapabilities.ACTION_EXECUTE,
        available: false,
        errorCode: PublicApiErrorCodes.API_NOT_IMPLEMENTED,
    }),
]);

function copyCapabilities() {
    return capabilityDefinitions.map((capability) => ({ ...capability }));
}

function createPublicApi() {
    const api = {
        getVersion() {
            return PUBLIC_API_VERSION;
        },
        getCapabilities() {
            return copyCapabilities();
        },
        hasCapability(name) {
            return capabilityDefinitions.some((capability) => capability.name === name && capability.available);
        },
    };

    Object.defineProperty(api, API_OWNER_MARKER, {
        value: API_OWNER,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    return Object.freeze(api);
}

function isOwnedPublicApi(value) {
    return value?.[API_OWNER_MARKER] === API_OWNER;
}

/**
 * Installs the API once and never replaces a global owned by another extension.
 * @param {Window | typeof globalThis | null | undefined} host
 * @returns {object | null}
 */
export function installYuziPhonePublicApi(host) {
    if (!host || (typeof host !== 'object' && typeof host !== 'function')) return null;

    const existing = host[PUBLIC_API_PROPERTY];
    if (existing) {
        return isOwnedPublicApi(existing) ? existing : null;
    }

    const api = createPublicApi();
    Object.defineProperty(host, PUBLIC_API_PROPERTY, {
        value: api,
        enumerable: true,
        configurable: true,
        writable: false,
    });
    return api;
}

/**
 * Removes only this extension's API object, preserving globals owned elsewhere.
 * @param {Window | typeof globalThis | null | undefined} host
 * @returns {boolean}
 */
export function uninstallYuziPhonePublicApi(host) {
    if (!host || !isOwnedPublicApi(host[PUBLIC_API_PROPERTY])) return false;
    return delete host[PUBLIC_API_PROPERTY];
}
