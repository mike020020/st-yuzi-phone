# 构建说明

## 首次设置

1. 安装 Node.js 18+。当前验证环境为 Node.js v22.19.0、npm 10.9.3。
2. 在扩展根目录执行：

```cmd
npm install
```

这会安装 esbuild 到 `node_modules/`。

## 日常开发

| 命令 | 用途 |
|------|------|
| `npm run build` | 生产构建（minified，发版用） |
| `npm run build:candidate:check` | 在系统临时目录执行生产候选构建，验证产物完整且正式 `dist/` 未被触碰 |
| `npm run build:dev` | 一次性开发构建（未压缩，调试用） |
| `npm run build:watch` | 监听模式（未压缩，自动重建） |
| `npm run lint` | 静态代码检查（ESLint） |
| `npm run check` | 运行全部 contract checks，任何失败都会让命令失败 |
| `npm run check:ci` | 运行全部 contract checks，并额外校验历史失败基线是否仍匹配；当前基线应为 0 |
| `npm run tables:check` | 校验 `tables/sources/` 与 `tables/generated/` 的表源契约和新鲜度 |
| `npm run tables:build` | 从 `tables/sources/` 重新生成 `tables/generated/` 表格模板产物 |

生产构建输出：

- `dist/yuzi-phone.bundle.js`
- `dist/yuzi-phone.bundle.js.map`
- `dist/yuzi-phone.bundle.css`
- `dist/yuzi-phone.bundle.css.map`

开发构建与监听模式也输出到同一组 `dist/` 文件。发版前必须重新执行 `npm run build`，不要把开发构建产物提交到 main。

需要为候选验证或真实宿主 probe 生成隔离产物时，必须显式指定输出目录：

```cmd
node build.mjs --outdir <候选目录>
```

相对路径以扩展根目录为基准，但解析后的候选目录必须位于项目目录之外；推荐直接使用系统临时目录的绝对路径。`--dev`、`--watch` 可以与 `--outdir` 组合，压缩和 source map 语义与默认构建保持一致。显式 `--outdir` 会拒绝项目根目录、项目内任意目录、项目祖先目录和文件系统根目录；参数缺值、重复参数和未知参数也会在写入前失败。候选构建只删除并重建四个固定 bundle/map 产物，不会清理目标目录中的 probe 元数据或其他文件。无 `--outdir` 的 canonical build 仍按既有合同整目录清理并输出到正式 `dist/`。

候选目录不是发布入口：不得修改 `manifest.json` 或 loader 指向候选目录，不得用候选产物替代正式 `dist/` 提交。P7/P8 使用候选产物；只有真实 SillyTavern probe 全部通过后，P9 才执行无 `--outdir` 的 canonical build 更新正式 `dist/`。

隔离合同可独立验证：

```cmd
npm run build:candidate:check
```

小手机发布前的最低自动化门禁是：`npm run lint`、`npm run check`、`npm run check:ci`、`npm run tables:check`、`npm run tables:build`、`npm run build:candidate:check`、`npm run build` 全部通过。`check` 证明合同脚本真实全绿；`check:ci` 额外证明历史失败基线没有过期或重新堆积；`tables:check` / `tables:build` 证明表源 Markdown 与 generated JSON 未漂移；候选构建检查证明自定义输出不会改写正式 `dist/`。玉子美化制作工具是独立发布单元，其安装、检查、测试、打包和回读在该项目自身目录执行，不由小手机构建链代跑。

当前发布链路还显式检查脚本版 loader 互斥、`window.__YUZI_PHONE_INSTANCE__` singleton guard、版本字段、release/dist 交付与 table source 边界；对应 contract 入口分别是 `scripts/check-script-loader-contract.cjs`、`scripts/check-extension-version-contract.cjs`、`scripts/check-release-chain-contract.cjs` 与 `scripts/check-table-sources-contract.cjs`。

## 文件结构

- `index.js`：源码 JS 入口。
- `style.css`：源码 CSS 入口。
- `modules/`：业务模块。
- `styles/`：样式分层源码。
- `build.mjs`：esbuild 打包脚本。
- `dist/`：构建产物。
- `scripts/`：contract 静态检查。

## 为什么 `dist/` 必须提交

SillyTavern 的 `auto_update: true` 只会拉取仓库内容，不会自动执行：

```cmd
npm install
npm run build
```

所以 `dist/` 不能加入 `.gitignore`。如果仓库里没有 `dist/`，使用 auto_update 的环境会拿不到实际加载入口。

## 发布新版本

1. 修改 `manifest.json` 的 `version`。
2. 同步修改 `index.js` 文件头 `@version` 和 `EXTENSION_VERSION`。
3. 在 `CHANGELOG.md` 顶部新增对应版本条目（从 `[Unreleased]` 拷贝并加日期）。
4. 执行：

```cmd
npm run lint
npm run check
npm run check:ci
npm run tables:check
npm run tables:build
npm run build:candidate:check
npm run build
```

5. 如果修改了表格模板，确认事实源来自 `tables/sources/` 下 Markdown；正式表源是 `小剧场2.1` 与 `纪要`，`恋爱特化参考` 是参考源，不要手工修改 `tables/generated/` 伪装成事实源。
6. 确认 `manifest.json` 的 `js` / `css` 仍指向 `dist/yuzi-phone.bundle.js` 与 `dist/yuzi-phone.bundle.css`，并确认这两个文件由上一步构建生成且非空。
7. 确认浏览器回归通过。
8. 提交以下关键文件：

```cmd
git add manifest.json index.js package.json package-lock.json build.mjs BUILD.md .gitignore .gitattributes .eslintrc.json CHANGELOG.md .github/ scripts/ tables/sources/ tables/generated/ dist/
```

9. 打 git tag 并推送：

```cmd
git tag v1.4.0
git push --tags
```

## 调试技巧

- 浏览器 Network 标签确认加载的是 `dist/yuzi-phone.bundle.js` 和 `dist/yuzi-phone.bundle.css`。
- 如果 Console 报错，优先看 sourcemap 映射到的源码位置。
- 如果样式异常，先确认 `dist/yuzi-phone.bundle.css` 是否重新生成。
- 如果扩展完全不加载，先检查 `manifest.json` 的 `js` / `css` 路径是否指向存在的文件。
