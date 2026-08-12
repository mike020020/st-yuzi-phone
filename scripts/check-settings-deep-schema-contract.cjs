const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

async function loadSchema() {
    return import(toModuleUrl('modules/settings/schema.js'));
}

async function testRemovedLegacyPhoneChatSetting() {
    const { validateSetting, validateSettings } = await loadSchema();
    const settings = validateSettings({
        phoneChat: { apiPresetName: 'legacy-preset' },
        phoneAiInstruction: { currentPresetName: 'legacy-preset' },
    });

    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'phoneChat'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'phoneAiInstruction'), false);
    assert.deepEqual(validateSetting('phoneChat', {}), { valid: true, value: undefined, removed: true });
    assert.deepEqual(validateSetting('phoneAiInstruction', {}), { valid: true, value: undefined, removed: true });
}

async function testRemovedWorldbookWorkbenchSetting() {
    const { defaultSettings, validateSetting, validateSettings } = await loadSchema();
    const settings = validateSettings({
        worldbookSelection: {
            sourceMode: 'manual',
            selectedWorldbook: '旧工作台数据',
            entries: { '旧工作台数据': { 1: true } },
        },
    });

    assert.equal(Object.prototype.hasOwnProperty.call(defaultSettings, 'worldbookSelection'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'worldbookSelection'), false);
    assert.deepEqual(validateSetting('worldbookSelection', {}), { valid: true, value: undefined, removed: true });
}

async function testRemovedLegacyDatabasePresetSettingsArePersisted() {
    const {
        defaultSettings,
        REMOVED_SETTING_KEYS,
        validateSetting,
        validateSettings,
    } = await loadSchema();
    const { migrateLegacyPhoneSettingsWith } = await import(toModuleUrl('modules/settings/migration.js'));
    let saveCount = 0;
    const context = {
        extensionSettings: {
            YuziPhone: {
                enabled: false,
                dbConfigPresets: [{ name: '旧数据库配置' }],
                activeDbConfigPreset: '旧数据库配置',
            },
        },
        saveSettingsDebounced() {
            saveCount += 1;
        },
    };

    migrateLegacyPhoneSettingsWith({
        getContext: () => context,
        extensionName: 'YuziPhone',
        defaultSettings,
        removedSettingKeys: REMOVED_SETTING_KEYS,
        clone: (value) => JSON.parse(JSON.stringify(value)),
        validateSettings,
    });

    const settings = context.extensionSettings.YuziPhone;
    assert.equal(settings.enabled, false);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'dbConfigPresets'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'activeDbConfigPreset'), false);
    assert.deepEqual(validateSetting('dbConfigPresets', []), { valid: true, value: undefined, removed: true });
    assert.deepEqual(validateSetting('activeDbConfigPreset', ''), { valid: true, value: undefined, removed: true });
    assert.equal(saveCount, 1, '清理已有用户设置后必须持久保存一次');
}

async function testAppearanceResourcePoolDeepNormalization() {
    const { validateSetting, validateSettings } = await loadSchema();
    const pngDataUrl = `data:image/png;base64,${Buffer.from('png-a').toString('base64')}`;
    const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from('jpeg-a').toString('base64')}`;

    const result = validateSetting('appearanceResourcePool', {
        wallpapers: [
            {
                id: '  wall-1  ',
                name: '  Wall 1  ',
                mime: 'IMAGE/PNG',
                dataUrl: pngDataUrl,
                hash: ' hash-wall-1 ',
                bytes: '999999',
                width: '1920.8',
                height: '1080.2',
                source: ' import ',
                extraKey: 'drop',
            },
            {
                id: 'duplicate-wall',
                name: 'Duplicate Wall',
                mime: 'image/png',
                dataUrl: pngDataUrl,
                hash: 'hash-wall-1',
            },
            {
                id: 'bad-wall',
                mime: 'text/plain',
                dataUrl: 'data:text/plain;base64,AAAA',
            },
        ],
        icons: [
            {
                id: 'icon-1',
                name: 'Icon 1',
                mime: 'image/jpeg',
                dataUrl: jpegDataUrl,
                hash: '',
                bytes: 1,
                width: -5,
                height: Infinity,
                source: 'pack',
            },
            null,
            {
                id: 'bad-icon',
                mime: 'image/png',
                dataUrl: 'not-a-data-url',
            },
        ],
        unknownRootKey: 'drop',
    });

    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result.value).sort(), ['icons', 'wallpapers']);
    assert.equal(result.value.wallpapers.length, 1);
    assert.equal(result.value.wallpapers[0].id, 'wall-1');
    assert.equal(result.value.wallpapers[0].name, 'Wall 1');
    assert.equal(result.value.wallpapers[0].mime, 'image/png');
    assert.equal(result.value.wallpapers[0].hash, 'hash-wall-1');
    assert.equal(result.value.wallpapers[0].width, 1921);
    assert.equal(result.value.wallpapers[0].height, 1080);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value.wallpapers[0], 'extraKey'), false);
    assert.equal(result.value.icons.length, 1);
    assert.equal(result.value.icons[0].id, 'icon-1');
    assert.equal(result.value.icons[0].mime, 'image/jpeg');
    assert.equal(result.value.icons[0].width, 0);
    assert.equal(result.value.icons[0].height, 0);
    assert.ok(result.value.icons[0].hash.startsWith('djb2:'));

    const settings = validateSettings({ appearanceResourcePool: [] });
    assert.deepEqual(settings.appearanceResourcePool, {
        wallpapers: [],
        icons: [],
    });
}

async function testAppearanceFontLibraryDeepNormalization() {
    const { validateSetting, validateSettings, APPEARANCE_FONT_LIBRARY_LIMITS } = await loadSchema();
    const woff2DataUrl = `data:font/woff2;base64,${Buffer.from('font-a').toString('base64')}`;
    const secondWoffDataUrl = `data:font/woff;base64,${Buffer.from('font-c').toString('base64')}`;
    const ttfDataUrl = `data:application/octet-stream;base64,${Buffer.from('font-b').toString('base64')}`;
    const cssUrl = 'https://fontsapi.zeoseven.com/3/main/result.css';

    const result = validateSetting('appearanceFontLibrary', {
        activeFontId: 'css-font-1',
        userFonts: [
            {
                id: ' user-font-1 ',
                name: '  Font A  ',
                family: ' Bad;Family"Name ',
                mime: 'FONT/WOFF2',
                format: 'woff2',
                dataUrl: woff2DataUrl,
                hash: ' hash-font-a ',
                bytes: 1234,
                source: ' import ',
                createdAt: '123.6',
                extraKey: 'drop',
            },
            {
                id: 'duplicate-font',
                name: 'Duplicate Font',
                mime: 'font/woff2',
                format: 'woff2',
                dataUrl: woff2DataUrl,
                hash: 'hash-font-a',
                bytes: 1234,
            },
            {
                id: 'font-ttf',
                name: 'Font TTF',
                format: 'ttf',
                dataUrl: ttfDataUrl,
                bytes: APPEARANCE_FONT_LIBRARY_LIMITS.singleFontBytes + 1,
            },
            {
                id: 'bad-font',
                mime: 'text/plain',
                format: 'txt',
                dataUrl: 'data:text/plain;base64,AAAA',
            },
            {
                id: ' css-font-1 ',
                name: '  寒蝉全圆体  ',
                family: ' 寒蝉全圆体 ',
                cssUrl,
                sourceType: 'css-url',
                bytes: 999999,
                source: ' remote ',
                createdAt: '456.2',
                extraKey: 'drop',
            },
            {
                id: 'duplicate-css-font',
                name: 'Duplicate Css Font',
                family: '寒蝉全圆体',
                cssUrl,
                sourceType: 'css-url',
            },
            {
                id: 'second-css-font',
                name: 'Second Css Font',
                family: '第二字体',
                cssUrl,
                sourceType: 'css-url',
            },
            {
                id: 'bad-css-font',
                family: 'Bad Font',
                cssUrl: 'http://fontsapi.zeoseven.com/3/main/result.css',
                sourceType: 'css-url',
            },
            {
                id: 'missing-family-css-font',
                cssUrl: 'https://fontsapi.zeoseven.com/3/main/missing-family.css',
                sourceType: 'css-url',
            },
        ],
        unknownRootKey: 'drop',
    });

    assert.equal(APPEARANCE_FONT_LIBRARY_LIMITS.singleFontBytes, 15 * 1024 * 1024);
    assert.equal(APPEARANCE_FONT_LIBRARY_LIMITS.totalFontBytes, 30 * 1024 * 1024);
    assert.equal(APPEARANCE_FONT_LIBRARY_LIMITS.urlLength, 2048);
    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result.value).sort(), ['activeFontId', 'userFonts']);
    assert.equal(result.value.activeFontId, 'css-font-1');
    assert.equal(result.value.userFonts.length, 3);
    assert.equal(result.value.userFonts[0].id, 'user-font-1');
    assert.equal(result.value.userFonts[0].name, 'Font A');
    assert.equal(result.value.userFonts[0].mime, 'font/woff2');
    assert.equal(result.value.userFonts[0].format, 'woff2');
    assert.equal(result.value.userFonts[0].sourceType, 'data-url');
    assert.equal(result.value.userFonts[0].family.includes(';'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.value.userFonts[0], 'extraKey'), false);
    assert.equal(result.value.userFonts[1].id, 'css-font-1');
    assert.equal(result.value.userFonts[1].name, '寒蝉全圆体');
    assert.equal(result.value.userFonts[1].family, '寒蝉全圆体');
    assert.equal(result.value.userFonts[1].cssUrl, cssUrl);
    assert.equal(result.value.userFonts[1].format, 'css');
    assert.equal(result.value.userFonts[1].bytes, 0);
    assert.equal(result.value.userFonts[1].sourceType, 'css-url');
    assert.equal(Object.prototype.hasOwnProperty.call(result.value.userFonts[1], 'extraKey'), false);
    assert.equal(result.value.userFonts[2].id, 'second-css-font');
    assert.equal(result.value.userFonts[2].family, '第二字体');
    assert.equal(result.value.userFonts[2].cssUrl, cssUrl);

    const totalBytes = result.value.userFonts.reduce((sum, font) => sum + (Number(font.bytes) || 0), 0);
    assert.equal(totalBytes, 1234);

    const totalLimitResult = validateSetting('appearanceFontLibrary', {
        activeFontId: 'builtin.system-ui',
        userFonts: [
            {
                id: 'font-1',
                family: 'Font One',
                format: 'woff2',
                dataUrl: woff2DataUrl,
                bytes: APPEARANCE_FONT_LIBRARY_LIMITS.totalFontBytes,
            },
            {
                id: 'font-2',
                family: 'Font Two',
                format: 'woff',
                dataUrl: secondWoffDataUrl,
                bytes: 1,
            },
        ],
    });
    assert.equal(totalLimitResult.value.userFonts.length, 1);

    const fallback = validateSetting('appearanceFontLibrary', {
        activeFontId: 'missing-font',
        userFonts: [],
    });
    assert.equal(fallback.value.activeFontId, 'builtin.system-ui');

    const cssFallback = validateSetting('appearanceFontLibrary', {
        activeFontId: 'missing-css-font',
        userFonts: [{ id: 'css-fallback', family: '回退字体', cssUrl, sourceType: 'css-url' }],
    });
    assert.equal(cssFallback.value.activeFontId, 'builtin.system-ui');

    const invalidProtocol = validateSetting('appearanceFontLibrary', {
        activeFontId: 'builtin.system-ui',
        userFonts: [{ id: 'js-font', family: '危险字体', cssUrl: 'javascript:alert(1)', sourceType: 'css-url' }],
    });
    assert.deepEqual(invalidProtocol.value.userFonts, []);

    const inferredSourceType = validateSetting('appearanceFontLibrary', {
        activeFontId: 'css-inferred-font',
        userFonts: [{ id: 'css-inferred-font', family: '推断字体', cssUrl }],
    });
    assert.equal(inferredSourceType.value.userFonts[0].sourceType, 'css-url');
    assert.equal(inferredSourceType.value.activeFontId, 'css-inferred-font');

    const settings = validateSettings({ appearanceFontLibrary: [] });
    assert.deepEqual(settings.appearanceFontLibrary, {
        activeFontId: 'builtin.system-ui',
        userFonts: [],
    });
}

async function testSharedNormalizersAreExported() {
    const schema = await loadSchema();
    assert.equal(Object.prototype.hasOwnProperty.call(schema, 'normalizeWorldbookSelectionSettings'), false);
    assert.equal(typeof schema.normalizeAppearanceResourcePoolSettings, 'function');
    assert.equal(typeof schema.normalizeAppearanceFontLibrarySettings, 'function');
}

async function testAppearanceActivePackIdNormalization() {
    const { validateSetting, validateSettings } = await loadSchema();

    const nullResult = validateSetting('appearanceActivePackId', null);
    assert.equal(nullResult.valid, true);
    assert.equal(nullResult.value, '');

    const normalResult = validateSetting('appearanceActivePackId', '  appearance_pack_123  ');
    assert.equal(normalResult.valid, true);
    assert.equal(normalResult.value, 'appearance_pack_123');

    const longId = 'a'.repeat(200);
    const longResult = validateSetting('appearanceActivePackId', longId);
    assert.equal(longResult.valid, true);
    assert.equal(longResult.value.length, 160);

    const settings = validateSettings({});
    assert.equal(settings.appearanceActivePackId, '');
}

async function testAppIconOriginsNormalization() {
    const { normalizeAppIconOriginsSettings, validateSetting, validateSettings } = await loadSchema();
    const raw = {
        '  table:one  ': '  appearance_pack_one  ',
        empty: '   ',
        constructor: 'appearance_pack_bad',
        prototype: 'appearance_pack_bad',
        valid: 'p'.repeat(200),
    };

    assert.deepEqual(normalizeAppIconOriginsSettings(raw), {
        'table:one': 'appearance_pack_one',
        valid: 'p'.repeat(160),
    });
    assert.deepEqual(validateSetting('appIconOrigins', []), {
        valid: false,
        value: {},
        error: 'appIconOrigins 必须是对象',
    });
    assert.deepEqual(validateSettings({ appIconOrigins: raw }).appIconOrigins, {
        'table:one': 'appearance_pack_one',
        valid: 'p'.repeat(160),
    });
}

async function main() {
    const tests = [
        ['已删除旧消息记录表设置不会重新进入设置事实源', testRemovedLegacyPhoneChatSetting],
        ['旧世界书工作台设置不会重新进入设置事实源', testRemovedWorldbookWorkbenchSetting],
        ['旧数据库预设设置会从已有用户设置中清理并持久保存', testRemovedLegacyDatabasePresetSettingsArePersisted],
        ['appearanceResourcePool 字段级归一化覆盖坏图片、重复资源和未知字段', testAppearanceResourcePoolDeepNormalization],
        ['appearanceFontLibrary 字段级归一化覆盖坏字体、重复字体和回退默认', testAppearanceFontLibraryDeepNormalization],
        ['settings schema 暴露共享嵌套 normalizer', testSharedNormalizersAreExported],
        ['appearanceActivePackId 默认值与长度限制校验', testAppearanceActivePackIdNormalization],
        ['appIconOrigins 只保留有效图标位与来源包 id', testAppIconOriginsNormalization],
    ];

    for (const [, run] of tests) {
        await run();
    }

    console.log('[settings-deep-schema-contract-check] 检查通过');
    for (const [description] of tests) {
        console.log(`- OK | ${description}`);
    }
}

main().catch((error) => {
    console.error('[settings-deep-schema-contract-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
