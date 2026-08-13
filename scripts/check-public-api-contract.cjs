const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();

async function main() {
    const moduleUrl = pathToFileURL(path.join(ROOT, 'modules/public-api/index.js')).href;
    const publicApi = await import(moduleUrl);
    const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const host = {};

    const api = publicApi.installYuziPhonePublicApi(host);
    assert.ok(api, 'install must create the public API');
    assert.equal(host.YuziPhoneAPI, api, 'API must be installed on the supplied host');
    assert.equal(api.getVersion(), '1.0.0');
    assert.equal(publicApi.installYuziPhonePublicApi(host), api, 'repeat install must be idempotent');

    const firstCapabilities = api.getCapabilities();
    const secondCapabilities = api.getCapabilities();
    assert.notEqual(firstCapabilities, secondCapabilities, 'capability snapshots must not expose internal storage');
    assert.deepEqual(
        firstCapabilities.map(({ name, available }) => [name, available]),
        [
            ['public-api.version', true],
            ['public-api.capabilities', true],
            ['app.register', true],
            ['scene.register', true],
            ['message.import', false],
            ['context.read', false],
            ['action.execute', false],
        ],
    );
    assert.equal(api.hasCapability('public-api.version'), true);
    assert.equal(api.hasCapability('app.register'), true);
    assert.equal(api.hasCapability('scene.register'), true);
    assert.equal(api.hasCapability('unknown.capability'), false);
    assert.equal(typeof api.registerApp, 'function');
    assert.equal(typeof api.unregisterApp, 'function');
    assert.equal(typeof api.registerScene, 'function');
    assert.equal(typeof api.unregisterScene, 'function');
    assert.equal(typeof api.navigate, 'function');
    assert.equal(typeof api.refreshScene, 'function');
    assert.equal(typeof api.importMessages, 'undefined');
    assert.equal(typeof api.getContext, 'undefined');
    assert.equal(typeof api.executeAction, 'undefined');
    assert.equal(
        firstCapabilities.find(({ name }) => name === 'message.import').errorCode,
        'YUZI_PHONE_API_NOT_IMPLEMENTED',
    );

    const events = [];
    const listener = (event) => events.push(event.eventName);
    assert.equal(api.on('app.registered', listener), true);
    const scene = await api.registerScene({ sceneId: 'contract.scene', render: () => ({ title: 'Contract' }) });
    const app = await api.registerApp({ appId: 'contract.app', name: 'Contract app', sceneId: scene.sceneId });
    assert.equal(app.route, 'public-app:contract.app');
    assert.deepEqual(events, ['app.registered']);
    assert.equal(await api.unregisterApp('contract.app'), true);
    assert.equal(await api.unregisterScene('contract.scene'), true);
    assert.equal(api.off('app.registered', listener), true);

    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), true);
    assert.equal('YuziPhoneAPI' in host, false, 'destroy cleanup must remove the owned API');
    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), false, 'repeat cleanup must be idempotent');
    assert.equal(publicApi.installYuziPhonePublicApi(null), null, 'a missing browser host must be a no-op');

    const foreign = { getVersion: () => 'foreign' };
    host.YuziPhoneAPI = foreign;
    assert.equal(publicApi.installYuziPhonePublicApi(host), null, 'install must not replace another owner');
    assert.equal(host.YuziPhoneAPI, foreign);
    assert.equal(publicApi.uninstallYuziPhonePublicApi(host), false, 'cleanup must preserve another owner');

    const guard = indexSource.indexOf('if (!acquireSingletonGuard()) return;');
    const install = indexSource.indexOf('installYuziPhonePublicApi(getInstanceHost());');
    const configure = indexSource.indexOf('configureErrorHandler({');
    assert.ok(guard >= 0 && install > guard && configure > install, 'entry must install after singleton ownership is acquired');
    assert.ok(indexSource.includes('uninstallYuziPhonePublicApi(getInstanceHost());'), 'failure and destroy paths must clean up the public API');

    console.log('[public-api-contract] passed');
}

main().catch((error) => {
    console.error('[public-api-contract] failed');
    console.error(error.stack || error);
    process.exitCode = 1;
});
