const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const load = file => import(pathToFileURL(path.resolve(file)).href);

async function main() {
    const { __test__createContentPresetWorkshopService } = await load('modules/content-presets/workshop-service.js');
    const preset = { id: 'preset-new', name: 'New', version: '1', author: 'test', items: [{ id: 'item-new' }] };
    const old = { sheetKey: 'sheet-a', presetId: 'preset-old', itemId: 'item-old' };

    function harness({
        active = [old], existing = null, failOperation = false, failCommit = false,
        failCleanup = false, failInvalidation = false, failConvergence = false,
    } = {}) {
        let index = { status: 'ready', error: null, revision: 1, metadata: new Map(), activeByTable: new Map(active.map(value => [value.sheetKey, value])) };
        const events = [];
        const operation = result => async () => { events.push('repository'); if (failOperation) throw new Error('repository failed'); return result; };
        const deps = {
            isContentPresetFullPageRuntimeEnabled: () => true,
            getContentPresetIndexSnapshot: () => index,
            subscribeContentPresetIndex: () => () => {},
            listPresetRecords: async () => [preset],
            buildContentPresetCatalog: () => [{ sheetKey: 'sheet-a', candidates: [{ presetId: 'preset-new', itemId: 'item-new' }] }],
            getPresetRecord: async () => existing,
            replacePresetRecord: operation({ record: preset, affectedSheetKeys: ['sheet-a'] }),
            deletePresetRecord: operation({ presetId: 'preset-old', affectedSheetKeys: ['sheet-a'] }),
            setActiveBinding: operation({ sheetKey: 'sheet-a', presetId: 'preset-new', itemId: 'item-new' }),
            clearActiveBinding: operation(undefined),
            clearAllActiveBindings: operation(undefined),
            contentPresetScrollRegistry: {
                clearByPreset(id) {
                    events.push(['preset', id]);
                    if (failCleanup) throw new Error('cleanup failed');
                },
                clearByBinding(binding) {
                    events.push(['binding', { ...binding }]);
                    if (failCleanup) throw new Error('cleanup failed');
                },
            },
            enqueueContentPresetMutation: async (run, buildPatch, afterCommit) => {
                const result = await run();
                const current = index;
                const patch = await buildPatch(result, current);
                if (failCommit) throw new Error('index commit failed');
                index = { ...index, ...patch.indexPatch, revision: index.revision + 1 };
                events.push('commit');
                await afterCommit?.(result, current, patch);
                return result;
            },
            invalidateContentPresetInstances: () => {
                events.push('invalidate');
                if (failInvalidation) throw new Error('invalidation failed');
            },
            convergeCurrentContentPresetRoute: async () => {
                events.push('converge');
                if (failConvergence) throw new Error('convergence failed');
            },
        };
        return { service: __test__createContentPresetWorkshopService(deps, { getTableData: () => ({}) }), events };
    }


    {
        const h = harness();
        await h.service.importPrepared({ record: preset }, false);
        assert.equal(h.events.some(event => Array.isArray(event)), false, '首次导入不得清理滚动缓存');
    }

    {
        const h = harness({ existing: { id: preset.id } });
        await h.service.importPrepared({ record: preset }, true);
        assert.deepEqual(h.events, ['repository', 'commit', ['preset', preset.id], 'invalidate', 'converge'], '覆盖必须按 commit、清理、失效、路由收敛的顺序完成');
    }

    {
        const h = harness();
        await h.service.deletePreset('preset-old');
        assert.deepEqual(h.events, ['repository', 'commit', ['preset', 'preset-old'], 'invalidate', 'converge'], '删除必须按完整 post-commit 顺序执行');
    }

    {
        const h = harness();
        await h.service.setActive('sheet-a', 'preset-new', 'item-new');
        assert.deepEqual(h.events.slice(0, 3), ['repository', 'commit', ['binding', old]], '设置新绑定只能清理该表旧 binding');
    }

    {
        const h = harness({ active: [] });
        await h.service.setActive('sheet-a', 'preset-new', 'item-new');
        assert.equal(h.events.some(event => Array.isArray(event)), false, '无旧 binding 时不得误清滚动缓存');
    }

    {
        const h = harness();
        await h.service.clearActive('sheet-a');
        assert.deepEqual(h.events.slice(0, 3), ['repository', 'commit', ['binding', old]], '单表解绑必须在 commit 后清理旧 binding');
    }

    {
        const second = { sheetKey: 'sheet-b', presetId: 'preset-b', itemId: 'item-b' };
        const h = harness({ active: [old, second] });
        await h.service.clearAllActive();
        assert.deepEqual(h.events.slice(0, 4), ['repository', 'commit', ['binding', old], ['binding', second]], '全部解绑必须只清理提交前现存 binding');
    }

    for (const failure of [{ failOperation: true }, { failCommit: true }]) {
        const h = harness(failure);
        await assert.rejects(() => h.service.deletePreset('preset-old'), /failed/);
        assert.equal(h.events.some(event => Array.isArray(event)), false, 'repository 未完成或 index commit 调用失败时不得清理滚动缓存');
        assert.equal(h.events.includes('invalidate'), false, '失败不得失效运行中实例');
        assert.equal(h.events.includes('converge'), false, '失败不得触发路由收敛');
    }

    for (const failure of [
        { failCleanup: true, phase: 'scroll-cleanup' },
        { failInvalidation: true, phase: 'instance-invalidation' },
        { failConvergence: true, phase: 'route-convergence' },
    ]) {
        const h = harness(failure);
        const result = await h.service.deletePreset('preset-old');
        assert.equal(result.presetId, 'preset-old', '已提交 mutation 的后置失败不得向 UI reject');
        assert.ok(h.events.includes('invalidate'), '清理失败后仍必须尝试实例失效');
        assert.ok(h.events.includes('converge'), '前序后置失败后仍必须尝试路由收敛');
    }

    {
        const h = harness({ failCleanup: true, failInvalidation: true, failConvergence: true });
        await h.service.deletePreset('preset-old');
        assert.ok(h.events.includes('invalidate'), '多个后置失败时仍必须尝试实例失效');
        assert.ok(h.events.includes('converge'), '多个后置失败时仍必须尝试路由收敛');
    }

    {
        const indexState = await load('modules/content-presets/index-state.js');
        let delivered = 0;
        const unsubscribeThrowing = indexState.subscribeContentPresetIndex(() => { throw new Error('fixture subscriber failed'); });
        const unsubscribeHealthy = indexState.subscribeContentPresetIndex(() => { delivered += 1; });
        const before = indexState.getContentPresetIndexSnapshot().revision;
        const committed = indexState.commitContentPresetIndex({ status: 'ready' });
        assert.equal(committed.revision, before + 1, 'subscriber 异常不得回滚已提交 revision');
        assert.equal(delivered, 1, '单个 subscriber 抛错不得阻断其他 subscriber');
        unsubscribeThrowing();
        unsubscribeHealthy();
    }

    {
        const indexState = await load('modules/content-presets/index-state.js');
        const coordinator = await load('modules/content-presets/mutation-coordinator.js');
        const firstBinding = { sheetKey: 'sheet-a', presetId: 'preset-first', itemId: 'item-first' };
        const secondBinding = { sheetKey: 'sheet-a', presetId: 'preset-second', itemId: 'item-second' };
        indexState.commitContentPresetIndex({
            status: 'ready',
            metadata: new Map(),
            activeByTable: new Map([[old.sheetKey, old]]),
        });

        let releaseFirst;
        const firstGate = new Promise(resolve => { releaseFirst = resolve; });
        let repositoryCalls = 0;
        const cleared = [];
        const records = [firstBinding, secondBinding];
        const service = __test__createContentPresetWorkshopService({
            isContentPresetFullPageRuntimeEnabled: () => true,
            enqueueContentPresetMutation: coordinator.enqueueContentPresetMutation,
            getContentPresetIndexSnapshot: indexState.getContentPresetIndexSnapshot,
            subscribeContentPresetIndex: indexState.subscribeContentPresetIndex,
            listPresetRecords: async () => [preset],
            buildContentPresetCatalog: () => [{
                sheetKey: 'sheet-a',
                candidates: [
                    { presetId: firstBinding.presetId, itemId: firstBinding.itemId },
                    { presetId: secondBinding.presetId, itemId: secondBinding.itemId },
                ],
            }],
            setActiveBinding: async () => {
                const call = repositoryCalls++;
                if (call === 0) await firstGate;
                return records[call];
            },
            contentPresetScrollRegistry: {
                clearByBinding(binding) { cleared.push({ ...binding }); },
                clearByPreset() {},
            },
            invalidateContentPresetInstances: () => {},
            convergeCurrentContentPresetRoute: async () => {},
        }, { getTableData: () => ({}) });

        const first = service.setActive('sheet-a', firstBinding.presetId, firstBinding.itemId);
        const second = service.setActive('sheet-a', secondBinding.presetId, secondBinding.itemId);
        for (let turn = 0; turn < 10 && repositoryCalls === 0; turn += 1) {
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.equal(repositoryCalls, 1, '第一个 mutation 必须已进入 repository，第二个仍需等待');
        releaseFirst();
        await Promise.all([first, second]);
        assert.deepEqual(cleared, [old, firstBinding], '第二个 mutation 必须清理第一个刚提交的 binding，而不是入队时旧快照');
        assert.deepEqual(indexState.getContentPresetIndexSnapshot().activeByTable.get('sheet-a'), secondBinding);
    }


    {
        class FakeHTMLElement {
            constructor() {
                this.isConnected = true;
                this.offsetHeight = 500;
                this.style = { minHeight: '', removeProperty: key => { if (key === 'min-height') this.style.minHeight = ''; } };
            }
        }
        global.HTMLElement = FakeHTMLElement;
        const body = new FakeHTMLElement();
        body.scrollTop = 0;
        body.scrollHeight = 1000;
        body.clientHeight = 400;
        const container = new FakeHTMLElement();
        let renders = 0;
        Object.defineProperty(container, 'innerHTML', {
            set() { renders += 1; body.scrollTop = 0; },
        });
        container.querySelector = selector => selector === '.phone-app-body.phone-settings-scroll' ? body : null;
        container.addEventListener = () => {};
        container.removeEventListener = () => {};

        const frames = [];
        const runtime = {
            isDisposed: () => false,
            requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
        };
        let snapshot = { revision: 0 };
        let listener = null;
        let fetchCount = 0;
        let resolveFirstMutation;
        const firstMutation = new Promise(resolve => { resolveFirstMutation = resolve; });
        const service = {
            getSnapshot: () => snapshot,
            subscribe(callback) { listener = callback; return () => { listener = null; }; },
            getViewModel() {
                fetchCount += 1;
                if (fetchCount === 1) return Promise.resolve({ status: 'ready', revision: 0, presets: [], tables: [] });
                if (fetchCount === 2) return firstMutation;
                return Promise.resolve({ status: 'ready', revision: 2, presets: [], tables: [] });
            },
        };
        const { createBeautifyTemplatePage } = await load('modules/settings-app/pages/beautify.js');
        const page = createBeautifyTemplatePage({ container, contentPresetWorkshopService: service, pageRuntime: runtime, state: {}, showToast: () => {} });
        page.mount();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(renders, 2, 'mount 只允许 loading 与初始 view-model 两次 render');

        body.scrollTop = 137;
        snapshot = { revision: 1 };
        listener(snapshot);
        snapshot = { revision: 2 };
        listener(snapshot);
        resolveFirstMutation({ status: 'ready', revision: 1, presets: [], tables: [] });
        await new Promise(resolve => setImmediate(resolve));
        while (frames.length) frames.shift()();

        assert.equal(fetchCount, 3, '连续 revision 必须合并，过期结果不得提交并只补取最新 revision');
        assert.equal(renders, 3, '连续 mutation 只能产生一次有效 view-model render');
        assert.equal(body.scrollTop, 137, '有效 refresh 后必须恢复 beautifyScrollTop');
        page.dispose();
    }


    console.log('[content-presets-workshop-ux-check] mutation 后置清理检查通过');
}

main().catch(error => {
    console.error('[content-presets-workshop-ux-check] 检查失败');
    console.error(error);
    process.exitCode = 1;
});
