# 表格 Markdown 格式

## 输入根合同

正式 `split` 只接受 JSON 对象，并要求：

- `mate` 是对象；
- `mate.type` 严格等于 `chatSheets`；
- 至少存在一个以 `sheet_` 开头的表；
- 每个 `sheet_*` 顶层 key 与该表的 `uid` 完全相同；
- `uid`、`name` 是非空字符串，`orderNo` 是非负整数；
- `sourceData`、`updateConfig`、`exportConfig` 是对象，`content` 是数组。

不以 `sheet_` 开头的其他顶层字段会作为未知根字段保存。`sheet_` 是表的保留命名空间；该前缀下的畸形值会报错，不能伪装成普通扩展字段。

## mate 文件

`00-mate.md` 的固定结构为：

````markdown
---
type: mate
---

# mate

## data

```json
{
  "type": "chatSheets",
  "version": 1
}
```
````

如果输入根对象还含有其他顶层字段，`split` 会追加可选的 `root.extra` JSON 对象。该对象不能包含 `mate` 或以 `sheet_` 开头的键。

## sheet 文件

每张表的 frontmatter 固定声明：

```yaml
type: sheet
uid: sheet_example
name: 示例表
orderNo: 0
```

文件名编号必须等于 `orderNo + 1`，例如 `orderNo: 0` 对应 `01-示例表.md`。一级标题必须与 `name` 相同。

固定 section 为：

- `sourceData.note`
- `sourceData.initNode`
- `sourceData.deleteNode`
- `sourceData.updateNode`
- `sourceData.insertNode`
- `sourceData.ddl`，必须使用 `sql` fenced code block
- `content`，必须使用 `json` fenced code block
- `updateConfig`，必须使用 `json` fenced code block
- `exportConfig`，必须使用 `json` fenced code block

`sourceData.note` 和 `sourceData.ddl` 不允许为空。`content` 必须是首行非空的二维数组；首行即表头。

## 未知字段保真

工具不会丢弃当前格式尚未认识的字段：

- 未知顶层字段写入 mate 文件的 `root.extra`；
- 未知 `sourceData` 字段写入 sheet 文件的 `sourceData.extra`；
- 未知 sheet 字段写入 sheet 文件的 `sheet.extra`。

三个 extra section 都是 JSON 对象，可保存字符串、数值、布尔值、`null`、数组或嵌套对象。extra 中不得再次声明固定字段；发生冲突时 `check` 和 `build` 会报错，而不是静默决定覆盖顺序。

## 编辑与往返规则

- fenced code block 的语言标记必须精确为 `json` 或 `sql`。
- section 标题不能重复，代码块必须闭合。
- 同一 source 目录只能有一个 `type: mate` 文件，至少有一个 `type: sheet` 文件。
- 表的 `uid`、`name`、`orderNo` 必须各自唯一。
- `check` 只解析和校验，不写文件。
- `build` 生成 JSON；source 是编辑入口，generated 是可重建产物。
- `roundtrip` 使用深度等价判断，确保 JSON → Markdown → JSON 不改变数据值。
