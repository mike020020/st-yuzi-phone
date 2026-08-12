# 玉子美化表格 Markdown 体系

本目录说明玉子美化自己的表格事实源。工具、Markdown 和生成 JSON 全部位于 `玉子美化/` 内，不读取玉子手机源码，也不调用角色卡构建或预设打包工具。

## 目录合同

```text
tables/
├─ sources/
│  ├─ 小剧场2.1/
│  └─ 纪要/
└─ generated/
   ├─ 小剧场2.1.json
   └─ 纪要.json
```

- `tables/sources/**` 是可编辑事实源：`00-mate.md` 保存根配置，其余文件一张表一份 Markdown。
- `tables/generated/**` 是从对应事实源合成并提交的 JSON。
- source 与 committed generated 必须深度等价；属性排列顺序不作为差异。
- 表源格式见 [markdown-source-format.md](markdown-source-format.md)。

## CLI

以下命令均在 `玉子美化/` 目录执行：

```powershell
node tools/table-source.cjs check "tables/sources/小剧场2.1"
node tools/table-source.cjs check "tables/sources/纪要"

node tools/table-source.cjs build "tables/sources/小剧场2.1" "tables/generated/小剧场2.1.json"
node tools/table-source.cjs build "tables/sources/纪要" "tables/generated/纪要.json"

node tools/table-source.cjs split <chatSheets.json> <输出目录>
node tools/table-source.cjs roundtrip <chatSheets.json>
```

`split` 默认拒绝写入已经含有 Markdown 的目录。只有明确允许替换这些 Markdown 时才使用 `--force`。`roundtrip` 只在系统临时目录工作并在结束后清理，不会向仓库写临时文件。

## 可编程 API

`tools/table-source.cjs` 是 CommonJS 模块，可由 ESM 代码通过 `createRequire()` 引入。稳定入口为：

```js
const {
  validateChatSheetsTemplate,
  splitTemplateToDirectory,
  buildTemplateFromDirectory,
} = require('./tools/table-source.cjs');
```

- `validateChatSheetsTemplate(document)`：校验并解析内存中的 `chatSheets` 根对象。
- `splitTemplateToDirectory(document, outputDir, options)`：把内存对象拆为 Markdown；`options.force` 默认为 `false`。
- `buildTemplateFromDirectory(sourceDir)`：读取 Markdown 目录并返回内存中的完整 JSON 对象。

模块使用 `require.main === module` 隔离 CLI；仅 `require()` 不会读取命令行参数、打印结果或设置退出码。

## 正式检查

`tests/table-source-tests.mjs` 同时检查两套正式 source，并将 `buildTemplateFromDirectory()` 的结果与 committed generated 使用深度等价比较。修改任一 Markdown 后，应重新生成对应 JSON，再运行：

```powershell
node tests/table-source-tests.mjs
```
