const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const url = file => pathToFileURL(path.join(ROOT, file)).href;
const clone = value => structuredClone(value);

function createLegacySpecialTemplate() {
    return {
        id: 'user.legacy.special',
        name: '旧聊天模板',
        templateType: 'special_app_template',
        source: 'user',
        readOnly: false,
        exportable: true,
        enabled: true,
        matcher: {},
        render: { rendererKey: 'special_message' },
        meta: {},
    };
}

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
    const repository = await import(url('modules/phone-beautify-templates/repository.js'));
    const matcher = await import(url('modules/phone-beautify-templates/matcher.js'));
    const cache = await import(url('modules/phone-beautify-templates/cache.js'));
    const store = await import(url('modules/phone-beautify-templates/store.js'));

    const genericUser = clone(repository.getBuiltinPhoneBeautifyTemplates()
        .find(item => item.id === 'builtin.generic.table.v1'));
    Object.assign(genericUser, { id: 'user.legacy.generic', source: 'user', readOnly: false });
    const legacySpecial = createLegacySpecialTemplate();

    ctx.extensionSettings[settings.extensionName] = {
        ...clone(settings.defaultSettings),
        yuziPhoneBeautifyTemplates: {
            schemaVersion: '1.0.0',
            updatedAt: 7,
            templates: [legacySpecial, genericUser],
            bindings: { legacy_special: legacySpecial.id, legacy_generic: genericUser.id },
        },
        beautifyTemplateSourceModeSpecial: 'user',
        beautifyTemplateSourceModeGeneric: 'user',
        beautifyActiveTemplateIdsSpecial: { special_message: legacySpecial.id },
        beautifyActiveTemplateIdGeneric: genericUser.id,
    };
    cache.invalidatePhoneBeautifyTemplateCache();

    const normalizedStore = store.readTemplateStore();
    assert.deepEqual(normalizedStore.templates.map(item => item.id), [genericUser.id]);
    assert.deepEqual(normalizedStore.bindings, { legacy_generic: genericUser.id });
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('special_app_template').templates.length, 0);
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('generic_table_template').preferredMode, 'user');
    assert.equal(repository.getActiveBeautifyTemplateIdByType('generic_table_template', { withFallback: false }), genericUser.id);

    const genericMatch = matcher.detectGenericTemplateForTable({
        sheetKey: 'legacy_generic', tableName: '历史通用表', headers: [],
    });
    assert.equal(genericMatch.template.id, genericUser.id);
    assert.equal(genericMatch.reason, 'manual_binding');

    const repair = repository.repairActiveBeautifyTemplateSettings();
    assert.equal(repair.genericUpdated, false, '有效 generic active 不得被 repair 覆盖');
    assert.equal(timers.size, 0, '纯读取与无变更 repair 不得调度保存');
    assert.equal(saveCalls, 0);

    const pageSource = fs.readFileSync('modules/settings-app/pages/beautify.js', 'utf8');
    const indexSource = fs.readFileSync('index.js', 'utf8');
    assert.ok(!pageSource.includes('getPhoneBeautifyTemplatesByType'));
    assert.ok(indexSource.includes('repairActiveBeautifyTemplateSettings();'));
    assert.ok(!indexSource.includes('restorePhoneBeautifyTemplatesToBuiltinDefaults'));
    console.log('[beautify-template-readonly-fallback-check] 检查通过');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
