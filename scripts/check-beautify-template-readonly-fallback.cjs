const assert = require('assert/strict');
const fs = require('fs');
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
    const repository = await import(url('modules/phone-beautify-templates/repository.js'));
    const matcher = await import(url('modules/phone-beautify-templates/matcher.js'));
    const cache = await import(url('modules/phone-beautify-templates/cache.js'));
    const store = await import(url('modules/phone-beautify-templates/store.js'));

    const builtins = repository.getBuiltinPhoneBeautifyTemplates();
    const specialUser = clone(builtins.find(item => item.id === 'builtin.special.message.v1'));
    Object.assign(specialUser, { id: 'user.legacy.special', source: 'user', readOnly: false });
    const genericUser = clone(builtins.find(item => item.id === 'builtin.generic.table.v1'));
    Object.assign(genericUser, { id: 'user.legacy.generic', source: 'user', readOnly: false });

    ctx.extensionSettings[settings.extensionName] = {
        ...clone(settings.defaultSettings),
        yuziPhoneBeautifyTemplates: {
            schemaVersion: '1.0.0',
            updatedAt: 7,
            templates: [specialUser, genericUser],
            bindings: { legacy_special: specialUser.id, legacy_generic: genericUser.id },
        },
        beautifyTemplateSourceModeSpecial: 'user',
        beautifyTemplateSourceModeGeneric: 'user',
        beautifyActiveTemplateIdsSpecial: { special_message: specialUser.id },
        beautifyActiveTemplateIdGeneric: genericUser.id,
    };
    const beforeSettings = clone(ctx.extensionSettings[settings.extensionName]);
    cache.invalidatePhoneBeautifyTemplateCache();

    const normalizedStore = store.readTemplateStore();
    assert.deepEqual(normalizedStore.templates.map(item => item.id).sort(), [genericUser.id, specialUser.id].sort());
    assert.deepEqual(normalizedStore.bindings, { legacy_special: specialUser.id, legacy_generic: genericUser.id });
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('special_app_template').preferredMode, 'user');
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('generic_table_template').preferredMode, 'user');
    assert.deepEqual(repository.getActiveBeautifyTemplateIdsForSpecial({ withFallback: false }), { special_message: specialUser.id });
    assert.equal(repository.getActiveBeautifyTemplateIdByType('generic_table_template', { withFallback: false }), genericUser.id);

    const specialMatch = matcher.detectSpecialTemplateForTable({
        sheetKey: 'legacy_special', tableName: '消息记录表', headers: ['会话ID', '发送者', '消息内容'],
    });
    const genericMatch = matcher.detectGenericTemplateForTable({
        sheetKey: 'legacy_generic', tableName: '历史通用表', headers: [],
    });
    assert.equal(specialMatch.template.id, specialUser.id);
    assert.equal(specialMatch.reason, 'manual_binding');
    assert.equal(genericMatch.template.id, genericUser.id);
    assert.equal(genericMatch.reason, 'manual_binding');

    const repair = repository.repairActiveBeautifyTemplateSettings();
    assert.equal(repair.specialUpdated, false, '有效历史 special active 不得被 repair 覆盖');
    assert.equal(repair.genericUpdated, false, '有效历史 generic active 不得被 repair 覆盖');
    assert.deepEqual(ctx.extensionSettings[settings.extensionName], beforeSettings, '兼容读取与 repair 不得改写有效历史设置');
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
