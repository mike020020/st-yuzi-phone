# 玉子美化 capability probe 与回滚

## 自动门禁

扩展根目录执行 `npm run check`、`npm run lint`、`npm run build`；独立制作项目执行 `npm run beautify:check` 与 `npm run beautify:readback`。

## 真实 SillyTavern 手动 probe

Agent 不主动打开浏览器。助手在真实 SillyTavern 中依次验证：

1. 导入 `玉子美化/output/basic-preset.json`，确认导入后不自动启用。
2. 对匹配的真实表设为当前，确认静态 HTML、注入 CSS、classic Blob 脚本工作。
3. 另制作 module 模式 fixture，确认 module Blob；若 CSP 阻断，应精确回原展示，禁止 classic/module 重试。
4. 分别验证图片、字体、音频 Blob 与 HTML `src/href/poster/srcset`、CSS `url()` 相对引用。
5. 快速切换 route，确认旧页面不再更新，viewing-sheet、context、script 与 Object URL 被清理。
6. 覆盖当前预设，确认旧绑定被清除且页面收敛到默认；重新设为当前后使用新版本。
7. 验证 Theater 失败回原 scene，Generic/Special 失败回原分派，`table-generic:` 永久旁路。
8. reload 后确认绑定恢复；删除/覆盖后检查 IndexedDB `yuzi-phone-template-workshop` 中 `presets` 与 `activeByTable` 一致。

记录浏览器、SillyTavern 版本、CSP Console 错误、通过/失败能力和复现步骤。probe 未通过前，不得宣称 Blob/CSP 能力已在真实宿主支持。

## 能力边界

支持 HTML `src/href/poster/srcset` 与 CSS `url()` 的包内资源改写。不支持 `@import`、module static/dynamic import、`import.meta.url`、JS 相对 `fetch()`，也不承诺 SVG 外链语义。自由 JavaScript 没有 sandbox；宿主只清理自身创建的 container、listener、context、script、style 与 Object URL，不承诺撤销作者创建的全局 DOM、timer、storage、network 等副作用。

## 工程回滚

回滚代码或构建产物时保留独立数据库 `yuzi-phone-template-workshop`，不得删除用户预设。旧版本忽略该数据库并继续原 App、Theater、Generic/Special 与旧 Beautify 行为。工程回滚不是预设历史或版本回滚功能。
