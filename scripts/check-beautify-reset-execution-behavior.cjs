const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const url = file => pathToFileURL(path.join(ROOT, file)).href;
const clone = value => structuredClone(value);

async function runFaultCase(mode) {
    let timerId = 0;
    const timers = new Map();
    const state = { phase: 'write' };
    const namespaceTarget = {};
    const throwingStore = new Proxy({}, {
        get(target, key, receiver) {
            if (key === 'templates') throw new Error('fixture template store read failure');
            return Reflect.get(target, key, receiver);
        },
    });
    const verificationNamespace = actualNamespace => new Proxy(actualNamespace, {
        get(target, key, receiver) {
            if (mode === 'verify-failed' && key === 'beautifyActiveTemplateIdsSpecial') {
                return { special_message: 'builtin.special.message.v1', stale: 'builtin.special.message.v1' };
            }
            if (mode === 'unexpected-error' && key === 'yuziPhoneBeautifyTemplates') {
                return throwingStore;
            }
            return Reflect.get(target, key, receiver);
        },
    });
    const extensionSettingsTarget = { YuziPhone: namespaceTarget };
    const extensionSettings = new Proxy(extensionSettingsTarget, {
        get(target, key, receiver) {
            if (key === 'YuziPhone' && state.phase === 'verify') return verificationNamespace(target.YuziPhone);
            return Reflect.get(target, key, receiver);
        },
        set(target, key, value, receiver) {
            const result = Reflect.set(target, key, value, receiver);
            if (key === 'YuziPhone' && state.phase === 'write') state.phase = 'verify';
            return result;
        },
    });
    const ctx = { extensionSettings, saveSettingsDebounced() {} };
    global.window = {
        getContext: () => ctx,
        setTimeout(callback) {
            const id = ++timerId;
            timers.set(id, () => {
                timers.delete(id);
                callback();
            });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };

    const settingsModule = await import(url('modules/settings.js'));
    Object.assign(namespaceTarget, clone(settingsModule.defaultSettings));
    const reset = await import(url('modules/phone-beautify-templates/reset.js'));
    const result = reset.restorePhoneBeautifyTemplatesToBuiltinDefaults();
    assert.equal(result.success, false);
    if (mode === 'verify-failed') {
        assert.equal(result.code, reset.BEAUTIFY_RESTORE_DEFAULTS_VERIFY_FAILED);
        assert.equal(result.verification.ok, false);
        assert.equal(result.verification.checks.specialActiveExact, false);
    } else {
        assert.equal(result.code, reset.BEAUTIFY_RESTORE_DEFAULTS_UNEXPECTED_ERROR);
    }
}

async function main() {
    const faultMode = process.argv[2];
    if (faultMode === 'verify-failed' || faultMode === 'unexpected-error') {
        await runFaultCase(faultMode);
        return;
    }
    const timers = new Map();
    let nextTimerId = 1;
    let saveCalls = 0;
    const ctx = {
        extensionSettings: {},
        saveSettingsDebounced() { saveCalls += 1; },
    };
    global.window = {
        getContext: () => ctx,
        setTimeout(callback) {
            const id = nextTimerId++;
            timers.set(id, () => {
                timers.delete(id);
                callback();
            });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };

    const settingsModule = await import(url('modules/settings.js'));
    const repository = await import(url('modules/phone-beautify-templates/repository.js'));
    const matcher = await import(url('modules/phone-beautify-templates/matcher.js'));
    const cache = await import(url('modules/phone-beautify-templates/cache.js'));
    const reset = await import(url('modules/phone-beautify-templates/reset.js'));

    const builtins = repository.getBuiltinPhoneBeautifyTemplates();
    const specialUser = clone(builtins.find(item => item.id === 'builtin.special.message.v1'));
    specialUser.id = 'user.legacy.special';
    specialUser.source = 'user';
    specialUser.readOnly = false;
    const genericUser = clone(builtins.find(item => item.id === 'builtin.generic.table.v1'));
    genericUser.id = 'user.legacy.generic';
    genericUser.source = 'user';
    genericUser.readOnly = false;

    ctx.extensionSettings[settingsModule.extensionName] = {
        ...clone(settingsModule.defaultSettings),
        enabled: false,
        yuziPhoneBeautifyTemplates: {
            schemaVersion: '1.0.0', updatedAt: 1,
            templates: [specialUser, genericUser],
            bindings: { legacy_special: specialUser.id, legacy_generic: genericUser.id },
        },
        beautifyTemplateSourceModeSpecial: 'user',
        beautifyTemplateSourceModeGeneric: 'user',
        beautifyActiveTemplateIdsSpecial: { special_message: specialUser.id, unknown_key: specialUser.id },
        beautifyActiveTemplateIdGeneric: genericUser.id,
    };
    cache.invalidatePhoneBeautifyTemplateCache();

    const beforeSpecial = matcher.detectSpecialTemplateForTable({
        sheetKey: 'legacy_special', tableName: '消息记录表', headers: ['会话ID', '发送者', '消息内容'],
    });
    const beforeGeneric = matcher.detectGenericTemplateForTable({
        sheetKey: 'legacy_generic', tableName: '历史通用表', headers: [],
    });
    assert.equal(beforeSpecial.template.id, specialUser.id, '恢复前历史 special binding 必须生效');
    assert.equal(beforeGeneric.template.id, genericUser.id, '恢复前历史 generic binding 必须生效');
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('special_app_template').preferredMode, 'user');
    assert.equal(repository.getBeautifyTemplateSourceModeRuntime('generic_table_template').preferredMode, 'user');
    assert.equal(cache.getCachedPhoneBeautifyTemplateById(specialUser.id).id, specialUser.id);

    const result = reset.restorePhoneBeautifyTemplatesToBuiltinDefaults();
    assert.equal(result.success, true);
    assert.equal(result.code, reset.BEAUTIFY_RESTORE_DEFAULTS_OK);
    assert.equal(result.verification.ok, true);
    const actual = ctx.extensionSettings[settingsModule.extensionName];
    assert.equal(actual.enabled, false, 'reset 不得修改无关设置');
    assert.deepEqual(actual.yuziPhoneBeautifyTemplates.templates, []);
    assert.deepEqual(actual.yuziPhoneBeautifyTemplates.bindings, {});
    assert.equal(actual.beautifyTemplateSourceModeSpecial, 'builtin');
    assert.equal(actual.beautifyTemplateSourceModeGeneric, 'builtin');
    assert.deepEqual(actual.beautifyActiveTemplateIdsSpecial, { special_message: 'builtin.special.message.v1' });
    assert.equal(actual.beautifyActiveTemplateIdGeneric, 'builtin.generic.table.v1');
    assert.equal(cache.getCachedPhoneBeautifyTemplateById(specialUser.id), null, '预热的旧模板不得复活');
    assert.equal(repository.getAllPhoneBeautifyTemplates().some(item => item.id === specialUser.id), false);
    assert.equal(repository.getPhoneBeautifyTemplatesByType('special_app_template').some(item => item.id === specialUser.id), false);
    assert.equal(matcher.detectSpecialTemplateForTable({ sheetKey: 'legacy_special', tableName: '消息记录表', headers: ['会话ID', '发送者', '消息内容'] }).template.id, 'builtin.special.message.v1');
    assert.equal(matcher.detectGenericTemplateForTable({ sheetKey: 'legacy_generic', tableName: '恢复默认验证表', headers: [] }).template.id, 'builtin.generic.table.v1');

    const second = reset.restorePhoneBeautifyTemplatesToBuiltinDefaults();
    assert.equal(second.success, true, '重复 reset 必须幂等');
    assert.deepEqual(ctx.extensionSettings[settingsModule.extensionName].beautifyActiveTemplateIdsSpecial, { special_message: 'builtin.special.message.v1' });

    const savedNamespace = ctx.extensionSettings;
    ctx.extensionSettings = null;
    const failed = reset.restorePhoneBeautifyTemplatesToBuiltinDefaults();
    assert.equal(failed.success, false);
    assert.equal(failed.code, reset.BEAUTIFY_RESTORE_DEFAULTS_WRITE_FAILED);
    ctx.extensionSettings = savedNamespace;
    assert.equal(saveCalls, 0, '防抖持久化回调不应同步执行');
    assert.ok(timers.size > 0, '成功 reset 应调度宿主保存');
    const firstScheduledId = timers.keys().next().value;
    timers.get(firstScheduledId)();
    assert.equal(saveCalls, 1, '触发防抖 timer 后必须调用一次宿主保存');
    assert.equal(timers.size, 0, '执行保存后必须清理 debounce 与 max-wait timer');

    const { spawnSync } = require('child_process');
    for (const mode of ['verify-failed', 'unexpected-error']) {
        const child = spawnSync(process.execPath, [__filename, mode], { cwd: ROOT, encoding: 'utf8' });
        assert.equal(child.status, 0, `${mode} fixture 失败\n${child.stdout}\n${child.stderr}`);
    }
    console.log('[beautify-reset-execution-behavior-check] 检查通过');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
