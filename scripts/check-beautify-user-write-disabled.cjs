const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const url = file => pathToFileURL(path.join(ROOT, file)).href;
const clone = value => structuredClone(value);

async function main() {
    const timers = new Map();
    let timerId = 0;
    let saveCalls = 0;
    const ctx = {
        extensionSettings: {},
        saveSettingsDebounced() { saveCalls += 1; },
    };
    global.window = {
        getContext: () => ctx,
        setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
    };

    const settings = await import(url('modules/settings.js'));
    const policy = await import(url('modules/phone-beautify-templates/policy.js'));
    const repository = await import(url('modules/phone-beautify-templates/repository.js'));
    const importer = await import(url('modules/phone-beautify-templates/import-export.js'));
    const matcher = await import(url('modules/phone-beautify-templates/matcher.js'));
    const cache = await import(url('modules/phone-beautify-templates/cache.js'));

    const builtinSpecial = repository.getBuiltinPhoneBeautifyTemplates()
        .find(item => item.id === 'builtin.special.message.v1');
    const userTemplate = clone(builtinSpecial);
    Object.assign(userTemplate, { id: 'user.legacy.special', source: 'user', readOnly: false });
    ctx.extensionSettings[settings.extensionName] = {
        ...clone(settings.defaultSettings),
        yuziPhoneBeautifyTemplates: {
            schemaVersion: '1.0.0', updatedAt: 11,
            templates: [userTemplate], bindings: { legacy_sheet: userTemplate.id },
        },
        beautifyTemplateSourceModeSpecial: 'user',
        beautifyActiveTemplateIdsSpecial: { special_message: userTemplate.id },
    };
    cache.invalidatePhoneBeautifyTemplateCache();
    const cachedBefore = cache.getCachedPhoneBeautifyTemplateById(userTemplate.id);
    assert.equal(cachedBefore.id, userTemplate.id);
    const settingsBefore = clone(ctx.extensionSettings[settings.extensionName]);
    const cacheVersionBefore = cache.getPhoneBeautifyTemplateCacheVersion();

    const calls = [
        () => repository.setBeautifyTemplateSourceMode('special_app_template', 'user'),
        () => repository.setActiveBeautifyTemplateIdByType('generic_table_template', 'user.any'),
        () => repository.savePhoneBeautifyUserTemplate({ id: 'user.any' }),
        () => repository.deletePhoneBeautifyUserTemplate('user.any'),
        () => importer.importPhoneBeautifyPackFromData('{}'),
        () => matcher.bindSheetToBeautifyTemplate('sheet', 'user.any'),
        () => matcher.clearSheetBeautifyBinding('sheet'),
    ];
    for (const invoke of calls) {
        const result = invoke();
        assert.equal(result.success, false);
        assert.equal(result.code, policy.BEAUTIFY_USER_TEMPLATE_WRITE_DISABLED);
        assert.equal(typeof result.message, 'string');
    }

    assert.deepEqual(ctx.extensionSettings[settings.extensionName], settingsBefore, '禁写 API 不得修改 settings/store');
    assert.equal(timers.size, 0, '禁写 API 不得调度宿主保存');
    assert.equal(saveCalls, 0, '禁写 API 不得触发宿主保存');
    assert.equal(cache.getPhoneBeautifyTemplateCacheVersion(), cacheVersionBefore, '禁写 API 不得失效模板缓存');
    assert.deepEqual(cache.getCachedPhoneBeautifyTemplateById(userTemplate.id), cachedBefore, '预热的历史模板缓存必须保持可读');
    console.log('[beautify-user-write-disabled-check] 检查通过');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
