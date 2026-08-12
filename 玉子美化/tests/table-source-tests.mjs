import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLES_ROOT = path.join(ROOT, 'tables');
const TOOL_FILE = path.join(ROOT, 'tools', 'table-source.cjs');
const SCRATCH_ROOT = path.join(ROOT, '.tmp-tests');
const tableSource = require(TOOL_FILE);

const {
    validateChatSheetsTemplate,
    splitTemplateToDirectory,
    buildTemplateFromDirectory,
    checkSourceDirectory,
    roundtripTemplate,
    writeTemplateFromSource,
} = tableSource;

for (const name of [
    'validateChatSheetsTemplate',
    'splitTemplateToDirectory',
    'buildTemplateFromDirectory',
    'writeTemplateFromSource',
]) {
    assert.equal(typeof tableSource[name], 'function', `缺少稳定可编程 API：${name}`);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listRepositoryTableFiles() {
    const output = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.isFile()) output.push(path.relative(TABLES_ROOT, absolute).replace(/\\/g, '/'));
        }
    }
    visit(TABLES_ROOT);
    return output.sort();
}

function listToolTempDirectories() {
    if (!fs.existsSync(SCRATCH_ROOT)) return [];
    return fs.readdirSync(SCRATCH_ROOT)
        .filter(name => name.startsWith('table-source-'))
        .sort();
}

const repositoryFilesBefore = listRepositoryTableFiles();
const toolTempBefore = listToolTempDirectories();

const FORMAL_SOURCES = [
    {
        label: '小剧场2.1',
        sourceDir: path.join(TABLES_ROOT, 'sources', '小剧场2.1'),
        generatedFile: path.join(TABLES_ROOT, 'generated', '小剧场2.1.json'),
        expectedSheets: 6,
    },
    {
        label: '纪要',
        sourceDir: path.join(TABLES_ROOT, 'sources', '纪要'),
        generatedFile: path.join(TABLES_ROOT, 'generated', '纪要.json'),
        expectedSheets: 1,
    },
];

for (const definition of FORMAL_SOURCES) {
    const checked = checkSourceDirectory(definition.sourceDir);
    assert.deepEqual(checked, { mateCount: 1, sheetCount: definition.expectedSheets });

    const committed = readJson(definition.generatedFile);
    validateChatSheetsTemplate(committed);
    const rebuilt = buildTemplateFromDirectory(definition.sourceDir);
    assert.deepStrictEqual(rebuilt, committed, `${definition.label} source 与 committed generated 必须深度等价`);
    assert.equal(roundtripTemplate(definition.generatedFile), true, `${definition.label} committed generated 必须可无损往返`);

    const cliCheck = spawnSync(process.execPath, [TOOL_FILE, 'check', definition.sourceDir], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    assert.equal(cliCheck.status, 0, `${definition.label} CLI source check 失败：${cliCheck.stderr}`);
    assert.match(cliCheck.stdout, /check 通过/);
}

assert.throws(
    () => validateChatSheetsTemplate({ mate: { type: 'other', version: 1 }, sheet_bad: {} }),
    /mate\.type 必须为 chatSheets/,
);
assert.throws(
    () => validateChatSheetsTemplate({ mate: { type: 'chatSheets', version: 1 }, metadata: { enabled: true } }),
    /至少需要一个 sheet_\* 表/,
);
assert.throws(
    () => validateChatSheetsTemplate({ mate: { type: 'chatSheets', version: 1 }, sheet_bad: 'not-a-sheet' }),
    /不是 sheet 对象/,
);

const fixture = {
    mate: {
        type: 'chatSheets',
        version: 9,
        customMateField: { keep: true },
    },
    rootString: '保留根字符串',
    rootArray: [1, null, { nested: '根对象' }],
    rootObject: { enabled: false, threshold: 0 },
    sheet_custom: {
        uid: 'sheet_custom',
        name: '扩展字段表',
        sourceData: {
            note: '用于测试未知字段保真。',
            initNode: '',
            deleteNode: '',
            updateNode: '',
            insertNode: '',
            ddl: 'CREATE TABLE custom_table (row_id INTEGER PRIMARY KEY, value TEXT);',
            futureRule: { nested: ['a', 2, false, null] },
            futureScalar: 17,
        },
        content: [['row_id', '值'], [1, 'A|B']],
        updateConfig: { updateFrequency: -1 },
        exportConfig: { enabled: false },
        orderNo: 0,
        futureSheetObject: { mode: 'preserve' },
        futureSheetArray: [true, 3],
    },
};

fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'table-source-tests-'));
try {
    const dryRunSource = path.join(tempRoot, 'dry-run-source');
    const dryRunResult = splitTemplateToDirectory(fixture, dryRunSource, { dryRun: true });
    assert.deepEqual(dryRunResult, { mateCount: 1, sheetCount: 1 }, 'dry-run 必须保留拆分返回合同');
    assert.equal(fs.existsSync(dryRunSource), false, 'split dry-run 不得创建输出目录');

    const sourceDir = path.join(tempRoot, 'source');
    const splitResult = splitTemplateToDirectory(fixture, sourceDir);
    assert.deepEqual(splitResult, { mateCount: 1, sheetCount: 1 });

    const mateMarkdown = fs.readFileSync(path.join(sourceDir, '00-mate.md'), 'utf8');
    const sheetFile = path.join(sourceDir, '01-扩展字段表.md');
    const sheetMarkdown = fs.readFileSync(sheetFile, 'utf8');
    assert.match(mateMarkdown, /## root\.extra/);
    assert.match(sheetMarkdown, /## sourceData\.extra/);
    assert.match(sheetMarkdown, /## sheet\.extra/);
    assert.deepStrictEqual(buildTemplateFromDirectory(sourceDir), fixture, '未知根/sheet/sourceData 字段必须无损往返');

    const mateBeforeRejectedOverwrite = fs.readFileSync(path.join(sourceDir, '00-mate.md'), 'utf8');
    assert.throws(
        () => splitTemplateToDirectory(fixture, sourceDir),
        /已存在 Markdown 文件/,
    );
    assert.equal(
        fs.readFileSync(path.join(sourceDir, '00-mate.md'), 'utf8'),
        mateBeforeRejectedOverwrite,
        '覆盖被拒绝后不得修改既有文件',
    );
    assert.deepEqual(
        splitTemplateToDirectory(fixture, sourceDir, { dryRun: true, force: true }),
        { mateCount: 1, sheetCount: 1 },
        '已存在目录上的 force dry-run 必须返回相同统计',
    );
    assert.equal(
        fs.readFileSync(path.join(sourceDir, '00-mate.md'), 'utf8'),
        mateBeforeRejectedOverwrite,
        'force dry-run 不得修改既有 Markdown',
    );

    const forceSource = path.join(tempRoot, 'force-source');
    splitTemplateToDirectory(fixture, forceSource);
    fs.writeFileSync(path.join(forceSource, '99-stale.md'), '应由显式覆盖清理\n', 'utf8');
    const forcedFixture = structuredClone(fixture);
    forcedFixture.mate.version = 10;
    const forcedSplit = splitTemplateToDirectory(forcedFixture, forceSource, { force: true });
    assert.deepEqual(forcedSplit, { mateCount: 1, sheetCount: 1 });
    assert.equal(fs.existsSync(path.join(forceSource, '99-stale.md')), false, 'force split 必须清理过期 Markdown');
    assert.deepStrictEqual(buildTemplateFromDirectory(forceSource), forcedFixture, 'force split 必须安装完整的新事实源');

    const rollbackSource = path.join(tempRoot, 'rollback-source');
    splitTemplateToDirectory(fixture, rollbackSource);
    const rollbackMateBefore = fs.readFileSync(path.join(rollbackSource, '00-mate.md'), 'utf8');
    const originalOpenSync = fs.openSync;
    fs.openSync = function injectedOpenSync(filePath, flags, ...rest) {
        if (flags === 'wx' && path.basename(String(filePath)) === '01-扩展字段表.md') {
            const error = new Error('注入 split 写入失败');
            error.code = 'EIO';
            throw error;
        }
        return originalOpenSync.call(this, filePath, flags, ...rest);
    };
    try {
        assert.throws(
            () => splitTemplateToDirectory(forcedFixture, rollbackSource, { force: true }),
            /注入 split 写入失败/,
        );
    } finally {
        fs.openSync = originalOpenSync;
    }
    assert.equal(
        fs.readFileSync(path.join(rollbackSource, '00-mate.md'), 'utf8'),
        rollbackMateBefore,
        'force split 安装失败后必须恢复原 Markdown',
    );
    assert.deepStrictEqual(buildTemplateFromDirectory(rollbackSource), fixture, 'force split 回滚后事实源必须完整可读');

    const dryRunJson = path.join(tempRoot, 'dry-build', 'output.json');
    assert.deepStrictEqual(
        writeTemplateFromSource(sourceDir, dryRunJson, { dryRun: true }),
        fixture,
        'build dry-run 必须完成内存合成',
    );
    assert.equal(fs.existsSync(path.dirname(dryRunJson)), false, 'build dry-run 不得创建父目录');

    const builtJson = path.join(tempRoot, 'built', 'output.json');
    assert.deepStrictEqual(writeTemplateFromSource(sourceDir, builtJson), fixture);
    assert.deepStrictEqual(readJson(builtJson), fixture, 'build 必须写出深度等价 JSON');
    const builtBytes = fs.readFileSync(builtJson);
    assert.throws(() => writeTemplateFromSource(sourceDir, builtJson), /输出 JSON 已存在/);
    assert.deepEqual(fs.readFileSync(builtJson), builtBytes, '默认覆盖拒绝后不得修改 JSON');
    assert.deepStrictEqual(writeTemplateFromSource(sourceDir, builtJson, { dryRun: true, force: true }), fixture);
    assert.deepEqual(fs.readFileSync(builtJson), builtBytes, 'force dry-run 不得修改 JSON');

    fs.writeFileSync(builtJson, '{"sentinel":true}\n', 'utf8');
    assert.deepStrictEqual(writeTemplateFromSource(sourceDir, builtJson, { force: true }), fixture);
    assert.deepStrictEqual(readJson(builtJson), fixture, 'force build 必须替换普通 JSON 文件');

    const originalBuiltBytes = fs.readFileSync(builtJson);
    const originalLinkSync = fs.linkSync;
    fs.linkSync = function injectedLinkSync() {
        const error = new Error('注入 build 安装失败');
        error.code = 'EIO';
        throw error;
    };
    try {
        assert.throws(
            () => writeTemplateFromSource(sourceDir, builtJson, { force: true }),
            /注入 build 安装失败/,
        );
    } finally {
        fs.linkSync = originalLinkSync;
    }
    assert.deepEqual(fs.readFileSync(builtJson), originalBuiltBytes, 'force build 安装失败后必须恢复原 JSON');

    const directoryTarget = path.join(tempRoot, 'json-directory-target');
    fs.mkdirSync(directoryTarget);
    assert.throws(
        () => writeTemplateFromSource(sourceDir, directoryTarget, { force: true }),
        /目标不是普通文件/,
    );

    const invalidInputDir = path.join(tempRoot, 'invalid-input');
    assert.throws(
        () => splitTemplateToDirectory({ ...fixture, mate: { type: 'invalid', version: 1 } }, invalidInputDir),
        /mate\.type 必须为 chatSheets/,
    );
    assert.equal(fs.existsSync(invalidInputDir), false, '输入校验失败时不得创建输出目录');

    const conflictingSource = path.join(tempRoot, 'conflicting-extra');
    splitTemplateToDirectory(fixture, conflictingSource);
    const conflictingSheet = path.join(conflictingSource, '01-扩展字段表.md');
    const conflictingText = fs.readFileSync(conflictingSheet, 'utf8').replace(
        '"futureRule": {',
        '"note": "不得覆盖正式字段",\n  "futureRule": {',
    );
    fs.writeFileSync(conflictingSheet, conflictingText, 'utf8');
    assert.throws(
        () => buildTemplateFromDirectory(conflictingSource),
        /sourceData\.extra 不得包含保留字段 note/,
    );

    const malformedSource = path.join(tempRoot, 'malformed');
    fs.mkdirSync(malformedSource);
    fs.writeFileSync(path.join(malformedSource, '00-mate.md'), [
        '---',
        'type: mate',
        '---',
        '',
        '# mate',
        '',
        '## data',
        '',
        '```json',
        '{"type":"chatSheets","version":1}',
        '```',
        '',
    ].join('\n'));
    fs.writeFileSync(path.join(malformedSource, '01-坏表.md'), [
        '---',
        'type: sheet',
        'uid: sheet_bad',
        'name: 坏表',
        'orderNo: 0',
        '---',
        '',
        '# 坏表',
        '',
        '## sourceData.note',
        '',
        '缺少其他固定 section',
        '',
    ].join('\n'));
    assert.throws(() => buildTemplateFromDirectory(malformedSource), /缺少 section sourceData\.initNode/);

    const cliInput = path.join(tempRoot, 'cli-input.json');
    const cliSplitOutput = path.join(tempRoot, 'cli-split-output');
    const cliBuildOutput = path.join(tempRoot, 'cli-build-output.json');
    fs.writeFileSync(cliInput, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

    const cliHelp = spawnSync(process.execPath, [TOOL_FILE, 'help'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(cliHelp.status, 0, cliHelp.stderr);
    assert.match(cliHelp.stdout, /--dry-run/);
    assert.match(cliHelp.stdout, /--force/);

    const cliSplitDryRun = spawnSync(
        process.execPath,
        [TOOL_FILE, 'split', cliInput, cliSplitOutput, '--dry-run'],
        { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(cliSplitDryRun.status, 0, cliSplitDryRun.stderr);
    assert.match(cliSplitDryRun.stdout, /dry-run，未写入/);
    assert.equal(fs.existsSync(cliSplitOutput), false, 'CLI split dry-run 不得写入');

    const cliBuildDryRun = spawnSync(
        process.execPath,
        [TOOL_FILE, 'build', sourceDir, cliBuildOutput, '--dry-run'],
        { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(cliBuildDryRun.status, 0, cliBuildDryRun.stderr);
    assert.match(cliBuildDryRun.stdout, /dry-run，未写入/);
    assert.equal(fs.existsSync(cliBuildOutput), false, 'CLI build dry-run 不得写入');

    for (const [label, arguments_, expectedError] of [
        ['未知参数', ['split', cliInput, cliSplitOutput, '--unknown'], /不支持参数 --unknown/],
        ['重复参数', ['split', cliInput, cliSplitOutput, '--force', '--force'], /参数重复：--force/],
        ['额外位置参数', ['check', sourceDir, 'extra'], /需要 1 个位置参数，实际收到 2 个/],
        ['help 额外参数', ['help', 'extra'], /help 不接受额外参数/],
    ]) {
        const failedCli = spawnSync(process.execPath, [TOOL_FILE, ...arguments_], { cwd: ROOT, encoding: 'utf8' });
        assert.equal(failedCli.status, 1, `${label} 必须失败`);
        assert.match(failedCli.stderr, expectedError, `${label} 应输出可定位错误`);
    }
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    try {
        fs.rmdirSync(SCRATCH_ROOT);
    } catch (error) {
        if (!error || !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
}

const importOnly = spawnSync(
    process.execPath,
    ['-e', "require('./tools/table-source.cjs'); process.stdout.write('import-ok')"],
    { cwd: ROOT, encoding: 'utf8' },
);
assert.equal(importOnly.status, 0, importOnly.stderr);
assert.equal(importOnly.stdout, 'import-ok', 'require 模块时不得触发 CLI 输出');

assert.deepEqual(listRepositoryTableFiles(), repositoryFilesBefore, '测试与 roundtrip 不得向仓库 tables 写入临时文件');
assert.deepEqual(listToolTempDirectories(), toolTempBefore, 'roundtrip 结束后不得残留工具临时目录');

console.log('[table-source-tests] 通过');
for (const definition of FORMAL_SOURCES) {
    console.log(`- OK | ${definition.label} | source check 与 committed generated 深度等价`);
}
console.log('- OK | 未知字段无损往返；dry-run、显式覆盖、失败回滚、严格 CLI 与项目内临时目录通过');
