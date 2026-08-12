import { normalizeAppIconOriginsSettings } from '../../../settings/schema.js';

function cloneAppIcons(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
}

export function collectAppearancePackIcons(pack) {
    const resources = [
        ...(Array.isArray(pack?.icons) ? pack.icons : []),
        ...(Array.isArray(pack?.iconPool) ? pack.iconPool : []),
    ];
    const used = new Set();

    return resources.flatMap((resource, index) => {
        const dataUrl = String(resource?.dataUrl || '');
        if (!dataUrl || used.has(dataUrl)) return [];
        used.add(dataUrl);
        return [{
            id: String(resource?.id || `icon_${index + 1}`),
            name: String(resource?.name || resource?.id || `图标 ${index + 1}`),
            dataUrl,
        }];
    });
}

export function buildAppIconAssignment(settings, iconKey, dataUrl, sourcePackId = '') {
    const key = String(iconKey || '').trim();
    const sourceId = String(sourcePackId || '').trim().slice(0, 160);
    const appIcons = cloneAppIcons(settings?.appIcons);
    const appIconOrigins = normalizeAppIconOriginsSettings(settings?.appIconOrigins);

    if (!key || !dataUrl) {
        return { appIcons, appIconOrigins };
    }

    appIcons[key] = dataUrl;
    if (sourceId) {
        appIconOrigins[key] = sourceId;
    } else {
        delete appIconOrigins[key];
    }

    return { appIcons, appIconOrigins };
}

export function buildAppIconRemoval(settings, iconKey) {
    const key = String(iconKey || '').trim();
    const appIcons = cloneAppIcons(settings?.appIcons);
    const appIconOrigins = normalizeAppIconOriginsSettings(settings?.appIconOrigins);

    if (key) {
        delete appIcons[key];
        delete appIconOrigins[key];
    }

    return { appIcons, appIconOrigins };
}

export function buildPackIconOriginCleanup(settings, sourcePackId) {
    const sourceId = String(sourcePackId || '').trim();
    const appIcons = cloneAppIcons(settings?.appIcons);
    const appIconOrigins = normalizeAppIconOriginsSettings(settings?.appIconOrigins);
    const removedKeys = [];

    if (!sourceId) {
        return { appIcons, appIconOrigins, removedKeys };
    }

    Object.entries(appIconOrigins).forEach(([key, packId]) => {
        if (packId !== sourceId) return;
        delete appIcons[key];
        delete appIconOrigins[key];
        removedKeys.push(key);
    });

    return { appIcons, appIconOrigins, removedKeys };
}
