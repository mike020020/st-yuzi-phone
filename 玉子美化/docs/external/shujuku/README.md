# shujuku 外部资料索引

本目录保存 shujuku 数据库生态的原文镜像，供预设作者理解表结构、模板语法和外部数据库 API。以下正文文件逐字复制，不属于玉子美化 Runtime API 或 Bundle 合同。

| 文件 | 身份与适用范围 |
| --- | --- |
| [`syntax-reference.md`](./syntax-reference.md) | 数据库提示词模板变量、条件表达式和 `<if>` 语法参考 |
| [`自定义表建表指南.md`](./自定义表建表指南.md) | 面向 shujuku UI 的自定义表建表指南 |
| [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) | 历史版外部 API 说明；用于兼容旧资料，不作为当前 v7.0 方法清单 |


## 生态边界

这些资料中的入口对象主要是：

```js
window.AutoCardUpdaterAPI
```

它属于 shujuku 数据库插件，不由玉子美化 Runtime API v1 提供。一个只依赖玉子美化的预设不能假设该对象存在，也不能把数据库 CRUD、AI 或世界书方法写成 `mount(context)` 的标准能力。

玉子美化作者接口请查阅 [`../../runtime/runtime-api-v1.md`](../../runtime/runtime-api-v1.md)。
