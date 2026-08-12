const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const ROOT = process.cwd();
const WORKSHOP_ROOT = path.resolve(__dirname, '..');
const SCRATCH_ROOT = path.join(WORKSHOP_ROOT, '.tmp-tests');
const KNOWN_SHEET_FIELDS = new Set([
    'uid',
    'name',
    'sourceData',
    'content',
    'updateConfig',
    'exportConfig',
    'orderNo',
]);
const KNOWN_SOURCE_DATA_FIELDS = new Set([
    'note',
    'initNode',
    'deleteNode',
    'updateNode',
    'insertNode',
    'ddl',
]);
const REQUIRED_SHEET_SECTIONS = [
    'sourceData.note',
    'sourceData.initNode',
    'sourceData.deleteNode',
    'sourceData.updateNode',
    'sourceData.insertNode',
    'sourceData.ddl',
    'content',
    'updateConfig',
    'exportConfig',
];

function usage() {
    return [
        'Usage:',
        '  node tools/table-source.cjs split <inputJson> <outputDir> [--dry-run] [--force]',
        '  node tools/table-source.cjs check <sourceDir>',
        '  node tools/table-source.cjs build <sourceDir> <outputJson> [--dry-run] [--force]',
        '  node tools/table-source.cjs roundtrip <inputJson>',
        '  node tools/table-source.cjs help',
        '',
        'Examples:',
        '  node tools/table-source.cjs check tables/sources/小剧场2.1',
        '  node tools/table-source.cjs build tables/sources/小剧场2.1 tables/generated/小剧场2.1.json',
        '  node tools/table-source.cjs roundtrip tables/generated/小剧场2.1.json',
    ].join('\n');
}

function toAbsolute(inputPath) {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(ROOT, inputPath);
}

function toPosix(relativeOrAbsolutePath) {
    return relativeOrAbsolutePath.replace(/\\/g, '/');
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeTextExclusive(filePath, content) {
    const handle = fs.openSync(filePath, 'wx');
    try {
        fs.writeFileSync(handle, content, 'utf8');
    } finally {
        fs.closeSync(handle);
    }
}

function pathExists(filePath) {
    try {
        fs.lstatSync(filePath);
        return true;
    } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
    }
}

const renameWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function renameWithRetrySync(source, destination, attempts = 6) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            fs.renameSync(source, destination);
            return;
        } catch (error) {
            lastError = error;
            const retryable = process.platform === 'win32'
                && ['EPERM', 'EACCES', 'EBUSY'].includes(error && error.code)
                && attempt < attempts - 1;
            if (!retryable) throw error;
            Atomics.wait(renameWaitBuffer, 0, 0, 20 * (attempt + 1));
        }
    }
    throw lastError;
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(readText(filePath));
    } catch (error) {
        throw new Error(`无法解析 JSON 文件 ${toPosix(path.relative(ROOT, filePath))}: ${error.message}`);
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function padIndex(index) {
    return String(index).padStart(2, '0');
}

function sanitizeFileNameSegment(value) {
    const sanitized = String(value || '').trim().replace(/[<>:"/\\|?*]/g, '＿');
    if (!sanitized) {
        throw new Error('表名为空，无法生成文件名');
    }
    return sanitized;
}

function sheetFileName(sheet) {
    return `${padIndex(sheet.orderNo + 1)}-${sanitizeFileNameSegment(sheet.name)}.md`;
}

function parseFrontmatter(content, fileLabel) {
    const normalized = content.replace(/^\uFEFF/, '');
    const lines = normalized.split(/\r?\n/);
    if (lines[0] !== '---') {
        throw new Error(`${fileLabel}: 缺少文件开头 frontmatter 分隔符 ---`);
    }

    let endIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index] === '---') {
            endIndex = index;
            break;
        }
    }
    if (endIndex < 0) {
        throw new Error(`${fileLabel}: frontmatter 未闭合`);
    }

    const meta = {};
    for (let index = 1; index < endIndex; index += 1) {
        const line = lines[index];
        if (!line.trim()) continue;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            throw new Error(`${fileLabel}: frontmatter 第 ${index + 1} 行不是 key: value 格式`);
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key) {
            throw new Error(`${fileLabel}: frontmatter 存在空 key`);
        }
        if (Object.prototype.hasOwnProperty.call(meta, key)) {
            throw new Error(`${fileLabel}: frontmatter key 重复：${key}`);
        }
        meta[key] = value;
    }

    const body = lines.slice(endIndex + 1).join('\n');
    return { meta, body };
}

function parseSections(body, fileLabel) {
    const lines = body.split(/\r?\n/);
    const sections = new Map();
    let currentName = null;
    let currentStart = 0;
    let inFence = false;

    function commitSection(endIndex) {
        if (!currentName) return;
        const content = lines.slice(currentStart, endIndex).join('\n').replace(/^\n+|\n+$/g, '');
        if (sections.has(currentName)) {
            throw new Error(`${fileLabel}: section 重复：${currentName}`);
        }
        sections.set(currentName, content);
    }

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('```')) {
            inFence = !inFence;
        }
        if (!inFence && line.startsWith('## ')) {
            commitSection(index);
            currentName = line.slice(3).trim();
            if (!currentName) {
                throw new Error(`${fileLabel}: 第 ${index + 1} 行存在空 section 标题`);
            }
            currentStart = index + 1;
        }
    }
    if (inFence) {
        throw new Error(`${fileLabel}: 存在未闭合 fenced code block`);
    }
    commitSection(lines.length);
    return sections;
}

function extractTitle(body) {
    const match = body.match(/^#\s+(.+)\s*$/m);
    return match ? match[1].trim() : '';
}

function extractCodeBlock(sectionContent, expectedLang, fileLabel, sectionName) {
    const lines = sectionContent.split(/\r?\n/);
    let startIndex = -1;
    let lang = '';
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('```')) {
            startIndex = index;
            lang = line.slice(3).trim().toLowerCase();
            break;
        }
    }
    if (startIndex < 0) {
        throw new Error(`${fileLabel}: section ${sectionName} 缺少 fenced code block`);
    }
    if (lang !== expectedLang) {
        throw new Error(`${fileLabel}: section ${sectionName} 的代码块语言必须为 ${expectedLang}，当前为 ${lang || '(空)'}`);
    }

    let endIndex = -1;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith('```')) {
            endIndex = index;
            break;
        }
    }
    if (endIndex < 0) {
        throw new Error(`${fileLabel}: section ${sectionName} 的 fenced code block 未闭合`);
    }
    return lines.slice(startIndex + 1, endIndex).join('\n');
}

function parseJsonBlock(sectionContent, fileLabel, sectionName) {
    const raw = extractCodeBlock(sectionContent, 'json', fileLabel, sectionName);
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`${fileLabel}: section ${sectionName} 的 JSON 解析失败：${error.message}`);
    }
}

function parseOptionalJsonObjectSection(sections, sectionName, fileLabel) {
    if (!sections.has(sectionName)) return {};
    const value = parseJsonBlock(sections.get(sectionName), fileLabel, sectionName);
    if (!isPlainObject(value)) {
        throw new Error(`${fileLabel}: section ${sectionName} 必须为 JSON 对象`);
    }
    return value;
}

function assertNoReservedExtraKeys(extra, reservedKeys, fileLabel, sectionName) {
    for (const key of Object.keys(extra)) {
        if (reservedKeys.has(key)) {
            throw new Error(`${fileLabel}: section ${sectionName} 不得包含保留字段 ${key}`);
        }
    }
}

function assertValidRootExtra(extra, fileLabel) {
    for (const key of Object.keys(extra)) {
        if (key === 'mate' || key.startsWith('sheet_')) {
            throw new Error(`${fileLabel}: section root.extra 不得包含保留顶层字段 ${key}`);
        }
    }
}

function stringifyFrontmatter(meta) {
    return ['---', ...Object.entries(meta).map(([key, value]) => `${key}: ${value}`), '---'].join('\n');
}

function pickUnknownFields(value, knownFields) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !knownFields.has(key)));
}

function appendTextSection(lines, name, value) {
    lines.push('', `## ${name}`, '', value);
}

function appendCodeSection(lines, name, language, value) {
    lines.push('', `## ${name}`, '', `\`\`\`${language}`, value, '\`\`\`');
}

function appendJsonSection(lines, name, value) {
    appendCodeSection(lines, name, 'json', JSON.stringify(value, null, 2));
}

function buildMateMarkdown(mate, rootExtra = {}) {
    const lines = [stringifyFrontmatter({ type: 'mate' }), '', '# mate'];
    appendJsonSection(lines, 'data', mate);
    if (Object.keys(rootExtra).length > 0) {
        appendJsonSection(lines, 'root.extra', rootExtra);
    }
    return `${lines.join('\n')}\n`;
}

function buildSheetMarkdown(sheet) {
    const sourceData = sheet.sourceData || {};
    const sourceDataExtra = pickUnknownFields(sourceData, KNOWN_SOURCE_DATA_FIELDS);
    const sheetExtra = pickUnknownFields(sheet, KNOWN_SHEET_FIELDS);
    const lines = [
        stringifyFrontmatter({
            type: 'sheet',
            uid: sheet.uid,
            name: sheet.name,
            orderNo: sheet.orderNo,
        }),
        '',
        `# ${sheet.name}`,
    ];

    appendTextSection(lines, 'sourceData.note', sourceData.note || '');
    appendTextSection(lines, 'sourceData.initNode', sourceData.initNode || '');
    appendTextSection(lines, 'sourceData.deleteNode', sourceData.deleteNode || '');
    appendTextSection(lines, 'sourceData.updateNode', sourceData.updateNode || '');
    appendTextSection(lines, 'sourceData.insertNode', sourceData.insertNode || '');
    appendCodeSection(lines, 'sourceData.ddl', 'sql', sourceData.ddl || '');
    if (Object.keys(sourceDataExtra).length > 0) {
        appendJsonSection(lines, 'sourceData.extra', sourceDataExtra);
    }
    appendJsonSection(lines, 'content', sheet.content);
    appendJsonSection(lines, 'updateConfig', sheet.updateConfig);
    appendJsonSection(lines, 'exportConfig', sheet.exportConfig);
    if (Object.keys(sheetExtra).length > 0) {
        appendJsonSection(lines, 'sheet.extra', sheetExtra);
    }
    return `${lines.join('\n')}\n`;
}

function validateChatSheetsTemplate(template) {
    if (!isPlainObject(template)) {
        throw new Error('输入 JSON 顶层必须是对象');
    }
    if (!isPlainObject(template.mate)) {
        throw new Error('输入 JSON 缺少对象类型的 mate');
    }
    if (template.mate.type !== 'chatSheets') {
        throw new Error('输入 JSON 的 mate.type 必须为 chatSheets');
    }

    const sheets = [];
    const rootExtra = {};
    const orderNos = new Map();
    for (const [key, value] of Object.entries(template)) {
        if (key === 'mate') continue;
        if (!key.startsWith('sheet_')) {
            rootExtra[key] = value;
            continue;
        }
        if (!isPlainObject(value)) {
            throw new Error(`顶层字段 ${key} 不是 sheet 对象`);
        }
        validateRawSheetForSplit(value, key);
        if (key !== value.uid) {
            throw new Error(`顶层 key ${key} 与 sheet.uid ${value.uid} 不一致`);
        }
        if (orderNos.has(value.orderNo)) {
            throw new Error(`orderNo 重复：${value.orderNo} (${orderNos.get(value.orderNo)} / ${value.name})`);
        }
        orderNos.set(value.orderNo, value.name);
        sheets.push(value);
    }
    sheets.sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, 'zh-CN'));
    if (sheets.length === 0) {
        throw new Error('输入 JSON 至少需要一个 sheet_* 表');
    }
    return { mate: template.mate, rootExtra, sheets };
}

function validateRawSheetForSplit(sheet, key) {
    const prefix = `sheet ${key}`;
    if (typeof sheet.uid !== 'string' || !sheet.uid.trim()) throw new Error(`${prefix}: uid 必须为非空字符串`);
    if (typeof sheet.name !== 'string' || !sheet.name.trim()) throw new Error(`${prefix}: name 必须为非空字符串`);
    if (!Number.isInteger(sheet.orderNo) || sheet.orderNo < 0) throw new Error(`${prefix}: orderNo 必须为非负整数`);
    if (!isPlainObject(sheet.sourceData)) throw new Error(`${prefix}: sourceData 必须为对象`);
    for (const field of ['note', 'initNode', 'deleteNode', 'updateNode', 'insertNode', 'ddl']) {
        if (typeof sheet.sourceData[field] !== 'string') {
            throw new Error(`${prefix}: sourceData.${field} 必须为字符串`);
        }
    }
    if (!Array.isArray(sheet.content)) throw new Error(`${prefix}: content 必须为数组`);
    if (!isPlainObject(sheet.updateConfig)) throw new Error(`${prefix}: updateConfig 必须为对象`);
    if (!isPlainObject(sheet.exportConfig)) throw new Error(`${prefix}: exportConfig 必须为对象`);
}

function assertCanWriteSplitOutput(outputDir, force) {
    if (!pathExists(outputDir)) return { exists: false, markdownFiles: [] };
    const stat = fs.lstatSync(outputDir);
    if (stat.isSymbolicLink()) {
        throw new Error(`输出路径不得是符号链接：${toPosix(path.relative(ROOT, outputDir))}`);
    }
    if (!stat.isDirectory()) {
        throw new Error(`输出路径不是目录：${toPosix(path.relative(ROOT, outputDir))}`);
    }
    const existingMarkdownFiles = [];
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
        if (!entry.name.toLowerCase().endsWith('.md')) continue;
        if (!entry.isFile()) {
            throw new Error(`输出目录中的 Markdown 目标不是普通文件：${entry.name}`);
        }
        existingMarkdownFiles.push(entry.name);
    }
    existingMarkdownFiles.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (existingMarkdownFiles.length > 0 && !force) {
        throw new Error(`输出目录已存在 Markdown 文件：${existingMarkdownFiles.join(', ')}。如需覆盖，请添加 --force`);
    }
    return { exists: true, markdownFiles: existingMarkdownFiles };
}

function parseTemplate(documentOrPath) {
    const document = typeof documentOrPath === 'string'
        ? readJsonFile(toAbsolute(documentOrPath))
        : documentOrPath;
    return validateChatSheetsTemplate(document);
}

function createSplitPlan(document, outputDir, options = {}) {
    const { mate, rootExtra, sheets } = validateChatSheetsTemplate(document);
    const target = assertCanWriteSplitOutput(outputDir, Boolean(options.force));
    const files = [{ name: '00-mate.md', content: buildMateMarkdown(mate, rootExtra) }];
    for (const sheet of sheets) {
        files.push({ name: sheetFileName(sheet), content: buildSheetMarkdown(sheet) });
    }
    return { target, files, mateCount: 1, sheetCount: sheets.length };
}

function installSplitPlan(plan, outputDir, force) {
    const parentDir = path.dirname(outputDir);
    fs.mkdirSync(parentDir, { recursive: true });
    const latestTarget = assertCanWriteSplitOutput(outputDir, force);
    const installedFiles = [];
    const backups = [];
    let backupDir = null;
    let createdOutputDir = false;
    let rollbackError = null;
    let preserveBackup = false;

    try {
        if (!latestTarget.exists) {
            fs.mkdirSync(outputDir);
            createdOutputDir = true;
        } else if (latestTarget.markdownFiles.length > 0) {
            backupDir = fs.mkdtempSync(path.join(parentDir, `.${path.basename(outputDir)}.table-backup-`));
            for (const fileName of latestTarget.markdownFiles) {
                const source = path.join(outputDir, fileName);
                const backup = path.join(backupDir, fileName);
                renameWithRetrySync(source, backup);
                backups.push({ source, backup });
            }
        }

        for (const file of plan.files) {
            const destination = path.join(outputDir, file.name);
            writeTextExclusive(destination, file.content);
            installedFiles.push(destination);
        }
    } catch (error) {
        for (const installed of installedFiles.reverse()) {
            try {
                fs.rmSync(installed, { force: true });
            } catch (cleanupError) {
                rollbackError ||= cleanupError;
            }
        }
        for (const entry of backups.reverse()) {
            try {
                if (pathExists(entry.source)) fs.rmSync(entry.source, { force: true });
                renameWithRetrySync(entry.backup, entry.source);
            } catch (restoreError) {
                rollbackError ||= restoreError;
            }
        }
        if (createdOutputDir) {
            try {
                fs.rmSync(outputDir, { recursive: true, force: true });
            } catch (cleanupError) {
                rollbackError ||= cleanupError;
            }
        }
        if (rollbackError) {
            preserveBackup = true;
            const backupLabel = backupDir ? toPosix(backupDir) : '(无备份目录)';
            throw new Error(`${error.message}；回滚失败：${rollbackError.message}；备份保留于 ${backupLabel}`, { cause: error });
        }
        throw error;
    } finally {
        if (backupDir && !preserveBackup) fs.rmSync(backupDir, { recursive: true, force: true });
    }
}

function splitTemplateToDirectory(document, outputDir, options = {}) {
    const force = Boolean(options.force);
    const plan = createSplitPlan(document, outputDir, { force });
    if (!options.dryRun) installSplitPlan(plan, outputDir, force);
    return { mateCount: plan.mateCount, sheetCount: plan.sheetCount };
}

function splitTemplate(inputJsonPath, outputDir, options = {}) {
    const document = readJsonFile(inputJsonPath);
    return splitTemplateToDirectory(document, outputDir, options);
}

function loadMarkdownFile(filePath) {
    const relativePath = toPosix(path.relative(ROOT, filePath));
    const content = readText(filePath);
    const { meta, body } = parseFrontmatter(content, relativePath);
    const sections = parseSections(body, relativePath);
    const title = extractTitle(body);
    return { filePath, relativePath, meta, body, sections, title };
}

function parseOrderNo(value, fileLabel) {
    if (!/^\d+$/.test(String(value || ''))) {
        throw new Error(`${fileLabel}: orderNo 必须为非负整数`);
    }
    return Number(value);
}

function parseSheetMarkdown(parsed) {
    const { meta, sections, title, relativePath } = parsed;
    const uid = String(meta.uid || '').trim();
    const name = String(meta.name || '').trim();
    const orderNo = parseOrderNo(meta.orderNo, relativePath);
    if (!uid) throw new Error(`${relativePath}: uid 必填`);
    if (!name) throw new Error(`${relativePath}: name 必填`);
    if (title !== name) {
        throw new Error(`${relativePath}: 一级标题 ${title || '(缺失)'} 与 name ${name} 不一致`);
    }

    for (const sectionName of REQUIRED_SHEET_SECTIONS) {
        if (!sections.has(sectionName)) {
            throw new Error(`${relativePath}: 缺少 section ${sectionName}`);
        }
    }

    const note = sections.get('sourceData.note').trim();
    if (!note) {
        throw new Error(`${relativePath}: sourceData.note 不允许为空`);
    }
    const ddl = extractCodeBlock(sections.get('sourceData.ddl'), 'sql', relativePath, 'sourceData.ddl');
    if (!ddl.trim()) {
        throw new Error(`${relativePath}: sourceData.ddl 不允许为空`);
    }

    const content = parseJsonBlock(sections.get('content'), relativePath, 'content');
    if (!Array.isArray(content) || !Array.isArray(content[0]) || content[0].length === 0) {
        throw new Error(`${relativePath}: content 必须是首行非空的二维数组`);
    }
    const updateConfig = parseJsonBlock(sections.get('updateConfig'), relativePath, 'updateConfig');
    if (!isPlainObject(updateConfig)) {
        throw new Error(`${relativePath}: updateConfig 必须为对象`);
    }
    const exportConfig = parseJsonBlock(sections.get('exportConfig'), relativePath, 'exportConfig');
    if (!isPlainObject(exportConfig)) {
        throw new Error(`${relativePath}: exportConfig 必须为对象`);
    }
    const sourceDataExtra = parseOptionalJsonObjectSection(sections, 'sourceData.extra', relativePath);
    const sheetExtra = parseOptionalJsonObjectSection(sections, 'sheet.extra', relativePath);
    assertNoReservedExtraKeys(sourceDataExtra, KNOWN_SOURCE_DATA_FIELDS, relativePath, 'sourceData.extra');
    assertNoReservedExtraKeys(sheetExtra, KNOWN_SHEET_FIELDS, relativePath, 'sheet.extra');

    return {
        ...sheetExtra,
        uid,
        name,
        sourceData: {
            ...sourceDataExtra,
            note,
            initNode: sections.get('sourceData.initNode').trim(),
            deleteNode: sections.get('sourceData.deleteNode').trim(),
            updateNode: sections.get('sourceData.updateNode').trim(),
            insertNode: sections.get('sourceData.insertNode').trim(),
            ddl,
        },
        content,
        updateConfig,
        exportConfig,
        orderNo,
        __filePath: parsed.filePath,
        __relativePath: relativePath,
    };
}

function parseMateMarkdown(parsed) {
    const { sections, title, relativePath } = parsed;
    if (title !== 'mate') {
        throw new Error(`${relativePath}: mate 文件一级标题必须为 mate`);
    }
    if (!sections.has('data')) {
        throw new Error(`${relativePath}: mate 文件缺少 section data`);
    }
    const mate = parseJsonBlock(sections.get('data'), relativePath, 'data');
    if (!isPlainObject(mate)) {
        throw new Error(`${relativePath}: mate data 必须为对象`);
    }
    if (mate.type !== 'chatSheets') {
        throw new Error(`${relativePath}: mate.type 必须为 chatSheets`);
    }
    if (!Object.prototype.hasOwnProperty.call(mate, 'version')) {
        throw new Error(`${relativePath}: mate.version 必填`);
    }
    const rootExtra = parseOptionalJsonObjectSection(sections, 'root.extra', relativePath);
    assertValidRootExtra(rootExtra, relativePath);
    return { data: mate, rootExtra, __filePath: parsed.filePath, __relativePath: relativePath };
}

function assertSheetFileNumber(sheet) {
    const basename = path.basename(sheet.__filePath);
    const match = basename.match(/^(\d+)-/);
    if (!match) {
        throw new Error(`${sheet.__relativePath}: 文件名必须以两位编号和短横线开头，例如 02-表名.md`);
    }
    const actual = Number(match[1]);
    const expected = sheet.orderNo + 1;
    if (actual !== expected) {
        throw new Error(`${sheet.__relativePath}: 文件编号 ${actual} 与 orderNo + 1 (${expected}) 不一致`);
    }
}

function loadSourceDirectory(sourceDir) {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`source 目录不存在：${toPosix(path.relative(ROOT, sourceDir))}`);
    }
    if (!fs.statSync(sourceDir).isDirectory()) {
        throw new Error(`source 路径不是目录：${toPosix(path.relative(ROOT, sourceDir))}`);
    }

    const markdownFiles = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => path.join(sourceDir, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN'));

    if (markdownFiles.length === 0) {
        throw new Error(`source 目录没有 Markdown 文件：${toPosix(path.relative(ROOT, sourceDir))}`);
    }

    let mate = null;
    const sheets = [];
    for (const filePath of markdownFiles) {
        const parsed = loadMarkdownFile(filePath);
        const type = String(parsed.meta.type || '').trim();
        if (type === 'mate') {
            if (mate) {
                throw new Error(`${parsed.relativePath}: 只能存在一个 type: mate 文件，已存在 ${mate.__relativePath}`);
            }
            mate = parseMateMarkdown(parsed);
        } else if (type === 'sheet') {
            sheets.push(parseSheetMarkdown(parsed));
        } else {
            throw new Error(`${parsed.relativePath}: 未知或缺失 frontmatter type：${type || '(空)'}`);
        }
    }

    if (!mate) {
        throw new Error('source 目录缺少 type: mate 文件');
    }
    if (sheets.length === 0) {
        throw new Error('source 目录至少需要一个 type: sheet 文件');
    }

    validateUniqueSheets(sheets);
    for (const sheet of sheets) {
        assertSheetFileNumber(sheet);
    }
    sheets.sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, 'zh-CN'));
    return { mate, sheets };
}

function validateUniqueSheets(sheets) {
    const maps = {
        uid: new Map(),
        name: new Map(),
        orderNo: new Map(),
    };
    for (const sheet of sheets) {
        for (const field of Object.keys(maps)) {
            const value = sheet[field];
            if (maps[field].has(value)) {
                throw new Error(`${sheet.__relativePath}: ${field} 重复：${value}，已存在于 ${maps[field].get(value)}`);
            }
            maps[field].set(value, sheet.__relativePath);
        }
    }
}

function stripInternalFields(sheet) {
    const { __filePath, __relativePath, ...publicFields } = sheet;
    return publicFields;
}

function buildTemplateFromDirectory(sourceDir) {
    const { mate, sheets } = loadSourceDirectory(sourceDir);
    const output = { mate: mate.data, ...mate.rootExtra };
    for (const sheet of sheets) {
        output[sheet.uid] = stripInternalFields(sheet);
    }
    return output;
}

const buildTemplateFromSource = buildTemplateFromDirectory;

function assertCanWriteJsonOutput(outputJsonPath, force) {
    if (!pathExists(outputJsonPath)) return { exists: false };
    const stat = fs.lstatSync(outputJsonPath);
    if (stat.isSymbolicLink()) {
        throw new Error(`输出 JSON 不得是符号链接：${toPosix(path.relative(ROOT, outputJsonPath))}`);
    }
    if (!stat.isFile()) {
        throw new Error(`输出 JSON 目标不是普通文件：${toPosix(path.relative(ROOT, outputJsonPath))}`);
    }
    if (!force) {
        throw new Error(`输出 JSON 已存在：${toPosix(path.relative(ROOT, outputJsonPath))}。如需覆盖，请添加 --force`);
    }
    return { exists: true };
}

function installJsonOutput(outputJsonPath, content, force) {
    const parentDir = path.dirname(outputJsonPath);
    fs.mkdirSync(parentDir, { recursive: true });
    const target = assertCanWriteJsonOutput(outputJsonPath, force);
    const stagingDir = fs.mkdtempSync(path.join(parentDir, `.${path.basename(outputJsonPath)}.table-build-`));
    const stagedFile = path.join(stagingDir, 'candidate.json');
    const backupFile = path.join(stagingDir, 'original.json');
    let originalMoved = false;
    let candidateInstalled = false;
    let preserveStaging = false;

    try {
        writeTextExclusive(stagedFile, content);
        const latestTarget = assertCanWriteJsonOutput(outputJsonPath, force);
        if (latestTarget.exists) {
            renameWithRetrySync(outputJsonPath, backupFile);
            originalMoved = true;
        } else if (target.exists) {
            throw new Error(`输出 JSON 在写入前消失，已停止覆盖：${toPosix(path.relative(ROOT, outputJsonPath))}`);
        }

        fs.linkSync(stagedFile, outputJsonPath);
        candidateInstalled = true;
        fs.unlinkSync(stagedFile);
        if (originalMoved) fs.unlinkSync(backupFile);
    } catch (error) {
        let rollbackError = null;
        if (candidateInstalled) {
            try {
                fs.rmSync(outputJsonPath, { force: true });
            } catch (cleanupError) {
                rollbackError ||= cleanupError;
            }
        }
        if (originalMoved) {
            try {
                if (pathExists(outputJsonPath)) {
                    throw new Error(`目标路径已被其他进程占用：${toPosix(path.relative(ROOT, outputJsonPath))}`);
                }
                renameWithRetrySync(backupFile, outputJsonPath);
            } catch (restoreError) {
                rollbackError ||= restoreError;
            }
        }
        if (rollbackError) {
            preserveStaging = true;
            throw new Error(`${error.message}；回滚失败：${rollbackError.message}；备份保留于 ${toPosix(stagingDir)}`, { cause: error });
        }
        throw error;
    } finally {
        if (!preserveStaging) fs.rmSync(stagingDir, { recursive: true, force: true });
    }
}

function writeTemplateFromSource(sourceDir, outputJsonPath, options = {}) {
    const output = buildTemplateFromDirectory(sourceDir);
    const force = Boolean(options.force);
    assertCanWriteJsonOutput(outputJsonPath, force);
    if (!options.dryRun) installJsonOutput(outputJsonPath, formatJson(output), force);
    return output;
}

function checkSourceDirectory(sourceDir) {
    const { mate, sheets } = loadSourceDirectory(sourceDir);
    return { mateCount: mate ? 1 : 0, sheetCount: sheets.length };
}

const parseSourceDirectory = loadSourceDirectory;

function roundtripTemplate(inputJsonPath) {
    const original = readJsonFile(inputJsonPath);
    validateChatSheetsTemplate(original);
    fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'table-source-roundtrip-'));
    try {
        const sourceDir = path.join(tempDir, 'source');
        const outputJsonPath = path.join(tempDir, 'output.json');
        splitTemplate(inputJsonPath, sourceDir);
        const rebuilt = writeTemplateFromSource(sourceDir, outputJsonPath);
        if (!isDeepStrictEqual(original, rebuilt)) {
            throw new Error('roundtrip 失败：split 后 build 的 JSON 与原始 JSON 不等价');
        }
        return true;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        try {
            fs.rmdirSync(SCRATCH_ROOT);
        } catch (error) {
            if (!error || !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
    }
}

function parseCommandArguments(command, args, positionalCount, allowedFlags = []) {
    const allowed = new Set(allowedFlags);
    const flags = new Set();
    const positionals = [];
    for (const argument of args) {
        if (argument.startsWith('--')) {
            if (!allowed.has(argument)) {
                throw new Error(`${command} 不支持参数 ${argument}`);
            }
            if (flags.has(argument)) {
                throw new Error(`${command} 参数重复：${argument}`);
            }
            flags.add(argument);
            continue;
        }
        positionals.push(argument);
    }
    if (positionals.length !== positionalCount) {
        throw new Error(`${command} 需要 ${positionalCount} 个位置参数，实际收到 ${positionals.length} 个`);
    }
    return { positionals, flags };
}

function runCli(argv) {
    const [command, ...args] = argv;
    if (!command) {
        console.error(usage());
        return 1;
    }

    if (command === 'help' || command === '--help' || command === '-h') {
        if (args.length > 0) throw new Error('help 不接受额外参数');
        console.log(usage());
        return 0;
    }

    if (command === 'split') {
        const parsed = parseCommandArguments(command, args, 2, ['--dry-run', '--force']);
        const [inputJson, outputDir] = parsed.positionals;
        const force = parsed.flags.has('--force');
        const dryRun = parsed.flags.has('--dry-run');
        const result = splitTemplate(toAbsolute(inputJson), toAbsolute(outputDir), { force, dryRun });
        const status = dryRun ? '预检通过（dry-run，未写入）' : '完成';
        console.log(`[table-source] split ${status}：mate ${result.mateCount} 个，sheet ${result.sheetCount} 个 -> ${toPosix(outputDir)}`);
        return 0;
    }

    if (command === 'check') {
        const { positionals: [sourceDir] } = parseCommandArguments(command, args, 1);
        const result = checkSourceDirectory(toAbsolute(sourceDir));
        console.log(`[table-source] check 通过：mate ${result.mateCount} 个，sheet ${result.sheetCount} 个`);
        return 0;
    }

    if (command === 'build') {
        const parsed = parseCommandArguments(command, args, 2, ['--dry-run', '--force']);
        const [sourceDir, outputJson] = parsed.positionals;
        const force = parsed.flags.has('--force');
        const dryRun = parsed.flags.has('--dry-run');
        const output = writeTemplateFromSource(toAbsolute(sourceDir), toAbsolute(outputJson), { force, dryRun });
        const sheetCount = validateChatSheetsTemplate(output).sheets.length;
        const status = dryRun ? '预检通过（dry-run，未写入）' : '完成';
        console.log(`[table-source] build ${status}：${sheetCount} 张表 -> ${toPosix(outputJson)}`);
        return 0;
    }

    if (command === 'roundtrip') {
        const { positionals: [inputJson] } = parseCommandArguments(command, args, 1);
        roundtripTemplate(toAbsolute(inputJson));
        console.log(`[table-source] roundtrip 通过：${toPosix(inputJson)}`);
        return 0;
    }

    console.error(`未知命令：${command}\n\n${usage()}`);
    return 1;
}

if (require.main === module) {
    try {
        process.exitCode = runCli(process.argv.slice(2));
    } catch (error) {
        console.error(`[table-source] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    validateChatSheetsTemplate,
    parseTemplate,
    splitTemplateToDirectory,
    parseSourceDirectory,
    buildTemplateFromDirectory,
    parseFrontmatter,
    parseSections,
    extractCodeBlock,
    splitTemplate,
    loadSourceDirectory,
    buildTemplateFromSource,
    writeTemplateFromSource,
    checkSourceDirectory,
    roundtripTemplate,
    runCli,
};
