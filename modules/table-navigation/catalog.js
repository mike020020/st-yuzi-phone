import { getSheetKeys } from '../phone-core/data-api.js';
import { resolveTheaterSceneBySheetKey } from '../phone-theater/data.js';
import { detectSpecialTableType } from '../table-viewer/special/runtime.js';

export const TABLE_ROUTE_PREFIX = 'table:';

function normalizeText(value) {
    return String(value ?? '').trim();
}

function buildTableRoute(sheetKey) {
    const safeSheetKey = normalizeText(sheetKey);
    return safeSheetKey ? `${TABLE_ROUTE_PREFIX}${safeSheetKey}` : '';
}

function buildCatalogEntry(rawData, sheetKey, orderIndex) {
    const sheet = rawData?.[sheetKey];
    if (!sheet || typeof sheet !== 'object') return null;

    const tableName = normalizeText(sheet.name) || sheetKey;
    const theaterScene = resolveTheaterSceneBySheetKey(rawData, sheetKey);
    if (theaterScene) {
        return Object.freeze({
            sheetKey,
            tableName,
            orderIndex,
            presentation: 'theater',
            sceneId: theaterScene.id,
            route: buildTableRoute(sheetKey),
        });
    }

    const specialType = detectSpecialTableType(tableName);
    if (specialType) {
        return Object.freeze({
            sheetKey,
            tableName,
            orderIndex,
            presentation: 'special',
            specialType,
            route: buildTableRoute(sheetKey),
        });
    }

    return Object.freeze({
        sheetKey,
        tableName,
        orderIndex,
        presentation: 'generic',
        route: buildTableRoute(sheetKey),
    });
}

export function buildTableNavigationCatalog(rawData) {
    return Object.freeze(getSheetKeys(rawData)
        .map((sheetKey, orderIndex) => buildCatalogEntry(rawData, sheetKey, orderIndex))
        .filter(Boolean));
}

export function resolveTableNavigationTarget(rawData, sheetKey) {
    const safeSheetKey = normalizeText(sheetKey);
    if (!safeSheetKey) return null;
    return buildTableNavigationCatalog(rawData)
        .find(entry => entry.sheetKey === safeSheetKey) || null;
}

export function resolveAdjacentTableTarget(rawData, currentSheetKey, direction) {
    const safeDirection = normalizeText(direction);
    const catalog = buildTableNavigationCatalog(rawData);
    const result = {
        direction: safeDirection,
        currentSheetKey: normalizeText(currentSheetKey),
        tableCount: catalog.length,
        target: null,
        reason: '',
    };

    if (safeDirection !== 'previous' && safeDirection !== 'next') {
        return Object.freeze({ ...result, reason: 'invalid_direction' });
    }
    if (catalog.length === 0) {
        return Object.freeze({ ...result, reason: 'empty_catalog' });
    }
    if (catalog.length === 1) {
        return Object.freeze({ ...result, reason: 'single_table' });
    }

    const currentIndex = catalog.findIndex(entry => entry.sheetKey === result.currentSheetKey);
    if (currentIndex < 0) {
        return Object.freeze({ ...result, reason: 'anchor_not_found' });
    }

    const offset = safeDirection === 'previous' ? -1 : 1;
    const targetIndex = (currentIndex + offset + catalog.length) % catalog.length;
    return Object.freeze({ ...result, target: catalog[targetIndex] });
}
