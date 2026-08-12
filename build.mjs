// build.mjs
// 玉子手机扩展打包脚本
// 用法：node build.mjs                         （生产构建）
//      node build.mjs --dev                   （开发构建：未压缩，便于调试）
//      node build.mjs --watch                 （开发模式：文件变化自动重建）
//      node build.mjs --outdir <path>         （输出到受控目录）

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DEFAULT_OUTDIR = resolve(ROOT, 'dist');
const MANAGED_ARTIFACT_NAMES = [
    'yuzi-phone.bundle.js',
    'yuzi-phone.bundle.js.map',
    'yuzi-phone.bundle.css',
    'yuzi-phone.bundle.css.map',
    'assets/phone-home-wallpaper-light.jpg',
];

function parseBuildArgs(args) {
    let isDev = false;
    let isWatch = false;
    let outdir = DEFAULT_OUTDIR;
    let hasExplicitOutdir = false;
    const seen = new Set();

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--dev' || arg === '--watch') {
            if (seen.has(arg)) {
                throw new Error(`[build] 参数重复: ${arg}`);
            }
            seen.add(arg);
            isDev ||= arg === '--dev';
            isWatch ||= arg === '--watch';
            continue;
        }
        if (arg === '--outdir') {
            if (seen.has(arg)) {
                throw new Error('[build] 参数重复: --outdir');
            }
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('[build] --outdir 必须提供目录路径');
            }
            seen.add(arg);
            hasExplicitOutdir = true;
            outdir = resolve(ROOT, value);
            index += 1;
            continue;
        }
        throw new Error(`[build] 未知参数: ${arg}`);
    }

    return { isDev: isDev || isWatch, isWatch, outdir, hasExplicitOutdir };
}

function resolveRealPath(pathname) {
    return realpathSync.native?.(pathname) ?? realpathSync(pathname);
}

function resolveProspectiveRealPath(pathname) {
    let existingAncestor = pathname;
    while (!existsSync(existingAncestor)) {
        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) break;
        existingAncestor = parent;
    }
    if (!existsSync(existingAncestor)) {
        throw new Error(`[build] 无法解析输出目录的现存祖先: ${pathname}`);
    }
    const realAncestor = resolveRealPath(existingAncestor);
    const suffix = relative(existingAncestor, pathname);
    return suffix ? resolve(realAncestor, suffix) : realAncestor;
}

function isSameOrDescendant(parent, candidate) {
    const fromParent = relative(parent, candidate);
    return fromParent === '' || (!fromParent.startsWith('..') && !isAbsolute(fromParent));
}

function assertSafeOutputDirectory(outdir, hasExplicitOutdir) {
    const prospectiveRealOutdir = resolveProspectiveRealPath(outdir);
    const rootRealPath = resolveRealPath(ROOT);
    if (dirname(outdir) === outdir || dirname(prospectiveRealOutdir) === prospectiveRealOutdir) {
        throw new Error(`[build] 拒绝清理文件系统根目录: ${outdir}`);
    }
    if (!hasExplicitOutdir) {
        if (outdir !== DEFAULT_OUTDIR) {
            throw new Error(`[build] 默认输出目录异常: ${outdir}`);
        }
        return;
    }

    const lexicalUnsafe = isSameOrDescendant(ROOT, outdir) || isSameOrDescendant(outdir, ROOT);
    const realUnsafe = isSameOrDescendant(rootRealPath, prospectiveRealOutdir) || isSameOrDescendant(prospectiveRealOutdir, rootRealPath);
    if (lexicalUnsafe || realUnsafe) {
        throw new Error(`[build] 显式 --outdir 必须位于项目目录之外: ${outdir}`);
    }
}

const { isDev, isWatch, outdir, hasExplicitOutdir } = parseBuildArgs(process.argv.slice(2));
assertSafeOutputDirectory(outdir, hasExplicitOutdir);

function prepareOutputDirectory() {
    if (!hasExplicitOutdir) {
        if (existsSync(outdir)) {
            rmSync(outdir, { recursive: true, force: true });
        }
        mkdirSync(outdir, { recursive: true });
        return outdir;
    }

    mkdirSync(outdir, { recursive: true });
    assertSafeOutputDirectory(outdir, true);
    const realOutdir = resolveRealPath(outdir);
    for (const artifactName of MANAGED_ARTIFACT_NAMES) {
        assertSafeOutputDirectory(outdir, true);
        const artifactPath = resolve(realOutdir, artifactName);
        if (existsSync(artifactPath)) {
            rmSync(artifactPath, { recursive: true, force: true });
        }
    }
    return realOutdir;
}

const outputDirectory = prepareOutputDirectory();
const jsOutfile = resolve(outputDirectory, 'yuzi-phone.bundle.js');
const cssOutfile = resolve(outputDirectory, 'yuzi-phone.bundle.css');

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function assertBuildOutput(filePath, label) {
    if (!existsSync(filePath)) {
        throw new Error(`[build] ${label} 构建产物缺失: ${filePath}`);
    }
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size <= 0) {
        throw new Error(`[build] ${label} 构建产物为空或不是文件: ${filePath}`);
    }
    return stats.size;
}

function normalizeSourceMapLineEndings(filePath) {
    if (!existsSync(filePath)) return;

    const raw = readFileSync(filePath, 'utf8');
    const sourceMap = JSON.parse(raw);
    if (!Array.isArray(sourceMap.sourcesContent)) return;

    sourceMap.sourcesContent = sourceMap.sourcesContent.map((content) => {
        if (typeof content !== 'string') return content;
        return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    });

    const normalizedRaw = `${JSON.stringify(sourceMap)}\n`;
    if (normalizedRaw === raw) return;
    writeFileSync(filePath, normalizedRaw, 'utf8');
}

const sharedOptions = {
    bundle: true,
    minify: !isDev,
    sourcemap: isDev ? 'inline' : true,
    target: ['es2022'],
    format: 'esm',
    platform: 'browser',
    external: ['/script.js', '/scripts/world-info.js'],
    assetNames: 'assets/[name]',
    legalComments: 'none',
    logLevel: 'info',
};

const jsBuild = {
    ...sharedOptions,
    entryPoints: [resolve(ROOT, 'index.js')],
    outfile: jsOutfile,
    loader: {
        '.css': 'css',
    },
};

const cssBuild = {
    ...sharedOptions,
    entryPoints: [resolve(ROOT, 'style.css')],
    outfile: cssOutfile,
    loader: {
        '.jpg': 'file',
    },
};

if (isWatch) {
    const jsCtx = await esbuild.context(jsBuild);
    const cssCtx = await esbuild.context(cssBuild);
    await Promise.all([
        jsCtx.watch(),
        cssCtx.watch(),
    ]);
    console.log('[build] watching for changes...');
} else {
    const t0 = Date.now();
    await Promise.all([
        esbuild.build(jsBuild),
        esbuild.build(cssBuild),
    ]);
    normalizeSourceMapLineEndings(`${jsOutfile}.map`);
    normalizeSourceMapLineEndings(`${cssOutfile}.map`);

    const jsSize = assertBuildOutput(jsOutfile, 'JS');
    const cssSize = assertBuildOutput(cssOutfile, 'CSS');
    assertBuildOutput(resolve(outputDirectory, 'assets/phone-home-wallpaper-light.jpg'), '默认壁纸');
    console.log(`[build] done in ${Date.now() - t0}ms`);
    const displayRoot = hasExplicitOutdir ? `${outputDirectory}${sep}` : 'dist/';
    console.log(`        ${displayRoot}yuzi-phone.bundle.js  ${formatBytes(jsSize)}`);
    console.log(`        ${displayRoot}yuzi-phone.bundle.css ${formatBytes(cssSize)}`);
}
