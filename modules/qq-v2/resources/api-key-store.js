export const API_KEY_SECRETS_STORAGE_KEY = 'qq-v2.resources.api-key-secrets';
export const LEGACY_API_KEY_STORAGE_KEY = 'qq-v2.resources.api-key-encryption-key';

function asSecretMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function hasLegacyCipher(record) {
    return Boolean(record?.iv && record?.ciphertext);
}

function canDecryptLegacy(cryptoApi) {
    return typeof cryptoApi?.subtle?.decrypt === 'function';
}

function reentryRequired() {
    const error = new Error('This API key was saved by an older version and must be entered again');
    error.name = 'QQV2ResourceError';
    error.code = 'api_key_reentry_required';
    return error;
}

export function createQQV2ApiKeyStore(options = {}) {
    const storage = options.storage;
    const cryptoApi = options.cryptoApi;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
        throw new TypeError('QQ v2 API key store needs async get and set storage methods');
    }

    const readSecrets = async () => asSecretMap(await storage.get(API_KEY_SECRETS_STORAGE_KEY));

    return Object.freeze({
        async set(id, apiKey) {
            const secrets = await readSecrets();
            secrets[id] = String(apiKey);
            await storage.set(API_KEY_SECRETS_STORAGE_KEY, secrets);
        },
        async get(id, legacyRecord = null) {
            const secrets = await readSecrets();
            if (typeof secrets[id] === 'string') return secrets[id];
            if (!hasLegacyCipher(legacyRecord) || !canDecryptLegacy(cryptoApi)) throw reentryRequired();

            try {
                const legacyKey = await storage.get(LEGACY_API_KEY_STORAGE_KEY);
                if (!legacyKey) throw reentryRequired();
                const plainBuffer = await cryptoApi.subtle.decrypt(
                    { name: 'AES-GCM', iv: legacyRecord.iv },
                    legacyKey,
                    legacyRecord.ciphertext,
                );
                const apiKey = new TextDecoder().decode(plainBuffer);
                secrets[id] = apiKey;
                await storage.set(API_KEY_SECRETS_STORAGE_KEY, secrets);
                return apiKey;
            } catch (error) {
                if (error?.code === 'api_key_reentry_required') throw error;
                throw reentryRequired();
            }
        },
        async delete(id) {
            const secrets = await readSecrets();
            if (!Object.hasOwn(secrets, id)) return false;
            delete secrets[id];
            await storage.set(API_KEY_SECRETS_STORAGE_KEY, secrets);
            return true;
        },
    });
}
