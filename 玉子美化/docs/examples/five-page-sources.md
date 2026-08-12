# 五套页面源码参考

`references/pages/` 提供五套可拆取的页面源码，供预设作者学习、复制和改造。它们不是已经绑定用户表格的成品项目，也不会替作者检测、打包或创建 `project.json`。

每套目录都只有四个文件：

- `index.html`：当前页面的静态结构；
- `style.css`：以页面根 class 收窄的独立样式；
- `mount.js`：显式导出 `mount(context)`，读取单表快照并渲染；
- `README.md`：字段、语法和本地交互说明。

## 参考目录与表格

| 页面 | 目录 | 目标表名 | 主要保留内容 |
| --- | --- | --- | --- |
| 广场 | `references/pages/square/` | `广场表` | 动态、话题、图片/视频文字说明、评论串 |
| 论坛 | `references/pages/forum/` | `论坛表` | 四色封面、版面、主帖、热度、楼层评论 |
| 直播 | `references/pages/live/` | `直播表` | 剧场卡片、三类弹幕、稳定色调、逐房间显隐 |
| 小日记 | `references/pages/diary/` | `小日记表` | 暖白手帐、`PS/PPS`、`~~秘密~~`、五条上限 |
| 小日历 | `references/pages/calendar/` | `小日历表` | 月历、真实/抽象日期、关系日期、年份与日期选择 |

准确字段以各目录的 `README.md` 为准。制作前先用真实表文件执行 `node tools/inspect-tables.mjs <真实表文件>`，不要凭参考表头猜测用户数据。

## 怎样复制到自己的项目

1. 在 `projects/<你的项目>/` 中建立页面目录。
2. 从所需参考目录复制 `index.html`、`style.css`、`mount.js`；只选一页也可以。
3. 根据真实表头修改 `mount.js` 的字段读取和页面内容。
4. 基于 `templates/project.json` 创建自己的 `project.json`，登记入口文件和 MIME。
5. 在 item 的 `target.tableName` 与 `target.fields` 中填写真实表名和实际使用的字段。
6. 对自己的项目执行检查、打包和回读，不要修改参考目录来冒充用户项目。

单页登记形状如下，路径只是示意：

```json
{
  "id": "my-square",
  "name": "我的广场",
  "target": {
    "tableName": "广场表",
    "fields": ["发帖账号名", "帖子正文", "评论串"]
  },
  "entry": {
    "html": "pages/square/index.html",
    "css": "pages/square/style.css",
    "mount": "pages/square/mount.js"
  },
  "assets": []
}
```

同时要在 `files` 中把三个包路径映射到项目内源码，并分别声明 `text/html`、`text/css`、`text/javascript`。完整格式见 [`源码工程格式`](../bundle/source-project-format.md)。

## 共同运行时约定

五页只通过以下公开入口工作：

- `context.root`：查询静态挂载点、监听当前页面点击；
- `context.getState()`：取得当前单表只读快照；
- `context.subscribe(render)`：表状态更新时重绘；
- `context.actions`：顶部的返回、上一张、下一张和编辑请求。

所有表格文本都通过 `createElement` 与 `textContent` 写入 DOM。每个 `mount` 都返回幂等 disposer，用于移除根监听器并退订。详细合同见 [`Runtime API v1`](../runtime/runtime-api-v1.md)。

## 明确边界

这些参考页没有以下能力，也不应通过改造暗中引入：

- 写表、删除行、跨表读取或数据库调用；
- AI 生成、消息发送或世界书读写；
- 外部弹窗、宿主私有 DOM 或私有路由；
- 其他扩展提供的全局对象；
- 对仓库其他页面源码、样式或构建环境的运行时引用。

页面内的媒体说明、弹幕显隐、评论折叠、月份切换等都是临时视图状态，不会写回表格。参考目录故意没有 `project.json`：表匹配、项目 ID、作者信息和最终组合方式必须由预设作者根据自己的真实项目决定。
