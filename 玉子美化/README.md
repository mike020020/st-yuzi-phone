# 玉子美化制作项目

独立制作、严格校验、确定性打包和回读 `.yuzi-beautify.json`。宿主导入允许保存不完整项；本项目的制作期检查要求 ID、目标表、字段和入口资源完整。

## 命令

```cmd
npm run inspect
npm run check
npm run test
npm run pack
npm run readback
```

`inspect-tables` 接受真实 shujuku 根对象（`mate + sheet_*`）、直接 sheet 对象，或 `{ chatSheets }` / `{ sheets }` 外层，并归一化为 `sheetKey/tableName/headers/rows/specialType/isMessage`。`mate` 与其他根级元数据不会被当作表；消息记录表只用于识别和排除，不应制作预设项。

每个 item 只面向一张真实表；完整 Bundle 可以包含多个 item。匹配使用 Unicode NFKC、表名精确相等、声明字段必须存在，允许真实表额外字段和不同字段顺序。

`project.json` 必须声明项目内的 `tablesFile`。包路径与源路径都不得越出项目目录；严格检查拒绝空字段、NFKC 后重复字段、非法 Base64、缺失入口/资源以及无法匹配真实非消息表的 item。`readback` 会从 project 与源文件重建预期 Bundle，并进行规范序列化字节级对账。

支持 HTML `src/href/poster/srcset` 与 CSS `url()` 相对资源改写。不支持 `@import`、SVG 外链语义保证、module import、`import.meta.url` 或 JS 相对 `fetch()`。classic/module Blob 与 CSP 能力必须在真实 SillyTavern 中手动 probe。
