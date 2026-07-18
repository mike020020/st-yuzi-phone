# 数据库（shujuku）外部 API 调用文档

> **版本说明**：本文档基于 2026-07-02 从 `shujuku@spv7.0` 源码提取，涵盖 **104 个公开 API 方法**（分布在 10 个领域分组中）和 **AutoCardUpdaterV2API**（3 个 V2 方法）。
> 相较于 v5.5.7（89 个方法），v7.0 新增 **15 个方法**，包括 10 个 Agent 相关方法和 2 个世界书 Skill 元数据方法。
> 提取脚本：`extract_api.js`（按需重新运行即可跟随版本更新）。

---

## 访问 API

所有 API 方法通过全局对象 `window.AutoCardUpdaterAPI` 访问（在同域 iframe 中也可通过 `window.parent.AutoCardUpdaterAPI` 访问）：

```javascript
// 检查 API 是否可用
if (window.AutoCardUpdaterAPI) {
    const tableData = window.AutoCardUpdaterAPI.exportTableAsJson();
}
```

---

## 表格数据格式

`exportTableAsJson()` 返回的数据结构如下，这是所有表格操作的基础：

```javascript
{
  mate: { type: "chatSheets", version: 1 },
  sheet_0: {                       // 表格内部 key
    name: "重要人物表",              // 表格名（你在 UI 看到的名称）
    content: [
      ["姓名", "关系", "好感度", "状态"],  // 第 0 行 = 列名
      ["白娅", "伴侣", 95, "活跃"],        // 第 1 行起 = 数据
      ["络络", "朋友", 80, "活跃"]
    ]
  },
  sheet_1: {
    name: "重要物品表",
    content: [
      ["物品名", "数量", "描述"],
      ["治疗药水", 3, "恢复 50 HP"]
    ]
  }
}
```

---

## 目录

- [核心数据 API](#核心数据-api)
- [表格 CRUD API](#表格-crud-api)
- [表格锁定 API](#表格锁定-api)
- [回调注册 API](#回调注册-api)
- [模板预设 API](#模板预设-api)
- [剧情预设管理 API](#剧情预设管理-api)
- [数据管理 API](#数据管理-api)
- [设置与配置 API](#设置与配置-api)
- [世界书与 AI API](#世界书与-ai-api)
- [SQL 查询 API](#sql-查询-api)
- [综合工作流示例](#综合工作流示例)
- [AutoCardUpdaterV2API（新版 V2 界面）](#autocardupdaterv2api新版-v2-界面)
- [版本变化总结](#版本变化总结)

---

## 核心数据 API

核心数据读取与导入导出，共 **4** 个方法。

### `exportTableAsJson()`

导出当前合并后的所有表格数据。

**返回值**: `Object` - 包含 `mate` 和 `sheet_*` 的完整数据对象，格式见上方[表格数据格式](#表格数据格式)。表格按 AI 输出楼层合并后的结果。

```javascript
const allData = AutoCardUpdaterAPI.exportTableAsJson();
// 获取某张表的行数
const 人物表 = allData['sheet_0'];
console.log(人物表.name, '有', 人物表.content.length - 1, '条数据');
```

### `importTableAsJson(jsonString, options)`

导入并覆盖当前表格数据。

**参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| jsonString | string | 是 | - | JSON 格式的表格数据字符串 |
| options | object | 否 | `{}` | 配置选项 |

**options 支持**:
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| persist | boolean | `true` | 是否持久化到聊天历史；`false` 仅恢复运行时 |
| mode | string | `'import'` | `'restore'` 等价于 `persist: false` |

```javascript
// 全量导入（持久化）
const data = JSON.stringify({ mate: { type: "chatSheets", version: 1 }, sheet_0: { name: "角色状态", content: [["属性","值"],["生命","100"]] } });
const r = await AutoCardUpdaterAPI.importTableAsJson(data);

// 仅恢复运行时（不写回聊天历史）
await AutoCardUpdaterAPI.importTableAsJson(data, { mode: 'restore' });
```

### `restoreTableAsJson(jsonString)`

仅恢复运行时数据，不持久化。等价于 `importTableAsJson(jsonString, { mode: 'restore', persist: false })`。

```javascript
await AutoCardUpdaterAPI.restoreTableAsJson(jsonString);
```

### `triggerUpdate()`

外部触发增量更新。强制数据库脚本重新扫描聊天楼层并合并数据。适合在外部数据改动后调用。

```javascript
await AutoCardUpdaterAPI.triggerUpdate();
```

---

## 表格 CRUD API

对单个表格的行级增删改查，共 **6** 个方法（v7.0 新增 `mapValue`、`validate` 内部辅助方法）。所有方法均支持**两种调用方式**：

- 独立参数：`updateCell('表名', 1, '列名', 值)`
- 对象参数：`updateCell({ tableName: '表名', rowIndex: 1, colIdentifier: '列名', value: 值 })`

### `updateCell(tableNameOrOptions, rowIndex, colIdentifier, value)`

更新指定表格中单个单元格的值。

**参数**（独立参数形式）:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tableNameOrOptions | string \| object | 是 | 表格名称 |
| rowIndex | number \| string | 是 | 行索引（0=表头，1=第一行数据） |
| colIdentifier | string \| number | 是 | 列名或列序号 |
| value | any | 是 | 新值 |

**返回值**: `Promise<boolean>`

```javascript
// 使用列名更新
await AutoCardUpdaterAPI.updateCell('主角信息', 1, '自由点数', 5);
// 使用列索引更新
await AutoCardUpdaterAPI.updateCell('主角信息', 1, 3, 5);
```

### `updateRow(tableNameOrOptions, rowIndex, data)`

更新整行数据（只更新指定的列，其他列不变）。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tableNameOrOptions | string \| object | 是 | 表格名称 |
| rowIndex | number \| string | 是 | 行索引（1=第一行数据） |
| data | object | 是 | 列名-值映射 |

```javascript
await AutoCardUpdaterAPI.updateRow('主角信息', 1, {
  '力量': 15, '敏捷': 12, '体质': 14,
  '智力': 8, '感知': 16, '魅力': 10,
  '自由点数': 2
});
```

### `insertRow(tableNameOrOptions, data)`

在表尾插入新行。

```javascript
const rowIndex = await AutoCardUpdaterAPI.insertRow('背包物品', {
  '物品名称': '治疗药水', '数量': 3,
  '类别': '消耗品', '描述/效果': '恢复50点生命值'
});
if (rowIndex !== -1) console.log('新行索引:', rowIndex);
```

### `deleteRow(tableNameOrOptions, rowIndex)`

删除指定行（不能删除表头 rowIndex=0）。

```javascript
const success = await AutoCardUpdaterAPI.deleteRow('背包物品', 3);
```

---

## 表格锁定 API

控制表格、行、列、单元格的锁定状态，共 **11** 个方法。用于保护敏感数据不被 AI 误改写。

### `getTableLockState(sheetKey)`

获取指定表格的整体锁定状态。

| 参数       | 类型     | 必填  | 说明                    |
| -------- | ------ | --- | --------------------- |
| sheetKey | string | 是   | 表格内部 key（如 `sheet_0`） |

```javascript
const state = AutoCardUpdaterAPI.getTableLockState('sheet_0');
```

### `setTableLockState(sheetKey, lockState = {}, { merge = false } = {})`

设置锁定状态。

| 参数        | 类型      | 必填  | 默认值     | 说明        |
| --------- | ------- | --- | ------- | --------- |
| sheetKey  | string  | 是   | -       | 表格 key    |
| lockState | object  | 是   | `{}`    | 锁定配置      |
| merge     | boolean | 否   | `false` | 是否与现有状态合并 |

### `clearTableLocks(sheetKey)`

清除指定表格的所有锁定。

### `lockTableRow(sheetKey, rowIndex, locked = true)`

锁定/解锁某行。

### `lockTableCol(sheetKey, colIndex, locked = true)`

锁定/解锁某列。

### `lockTableCell(sheetKey, rowIndex, colIndex, locked = true)`

锁定/解锁某个单元格。

### `toggleTableRowLock(sheetKey, rowIndex)`

切换行的锁定状态。

### `toggleTableColLock(sheetKey, colIndex)`

切换列的锁定状态。

### `toggleTableCellLock(sheetKey, rowIndex, colIndex)`

切换单元格的锁定状态。

### `getSpecialIndexLockEnabled(sheetKey)`

获取特殊索引列（行号列）的锁定状态。

### `setSpecialIndexLockEnabled(sheetKey, enabled)`

设置特殊索引列的锁定状态。

```javascript
// 锁定主角信息表第 1 行的所有单元格（保护主角数据不被 AI 改写）
AutoCardUpdaterAPI.lockTableRow('sheet_0', 1, true);
// 切换背包物品表第 3 行的锁定
AutoCardUpdaterAPI.toggleTableRowLock('sheet_1', 3);
```

---

## 回调注册 API

注册/注销数据更新时的回调函数，共 **5** 个方法。

### `registerTableUpdateCallback(callback)`

注册表格更新回调。每次数据变化时调用。

| 参数       | 类型       | 必填  | 说明                                   |
| -------- | -------- | --- | ------------------------------------ |
| callback | function | 是   | `function(tableData) { ... }`，接收全量数据 |

```javascript
const handler = (data) => console.log('表格更新:', data);
AutoCardUpdaterAPI.registerTableUpdateCallback(handler);
// 稍后注销
// AutoCardUpdaterAPI.unregisterTableUpdateCallback(handler);
```

### `unregisterTableUpdateCallback(callback)`

注销之前注册的回调。

### `registerTableFillStartCallback(callback)`

注册"填表开始"回调。数据库脚本开始解析 AI 输出并提取表格数据时触发。

```javascript
AutoCardUpdaterAPI.registerTableFillStartCallback(() => {
  console.log('开始填表...');
});
```

### `_notifyTableUpdate()` / `_notifyTableFillStart()`

内部通知方法，手动触发回调（通常不需要外部调用）。

---

## 模板预设 API

管理表格模板预设，共 **5** 个方法。

### `getTemplatePresetNames()`

获取所有模板预设的名称列表。

```javascript
const names = AutoCardUpdaterAPI.getTemplatePresetNames();
// → ["标准模板", "任务模板", ...]
```

### `switchTemplatePreset(presetName, options = {})`

切换到指定模板预设。

| 参数            | 类型     | 必填  | 默认值      | 说明                             |
| ------------- | ------ | --- | -------- | ------------------------------ |
| presetName    | string | 是   | -        | 预设名称                           |
| options.scope | string | 否   | `'chat'` | `'global'`=全局模板，`'chat'`=仅当前聊天 |

```javascript
await AutoCardUpdaterAPI.switchTemplatePreset('标准模板', { scope: 'global' });
await AutoCardUpdaterAPI.switchTemplatePreset('任务模板', { scope: 'chat' });
```

### `injectTemplatePresetToCurrentChat(presetName)`

将指定模板预设注入到当前聊天。

### `importTemplateFromData(templateData, options = {})`

从数据对象导入模板预设。

| 参数                 | 类型     | 必填  | 默认值      | 说明                                 |
| ------------------ | ------ | --- | -------- | ---------------------------------- |
| templateData       | object | 是   | -        | 模板数据（格式同 `exportTableAsJson` 返回结构） |
| options.scope      | string | 否   | `'chat'` | 作用域                                |
| options.presetName | string | 否   | -        | 保存为的预设名                            |

```javascript
const template = {
  mate: { type: "chatSheets", version: 1 },
  sheet_0: {
    name: "角色状态",
    content: [["属性", "值"], ["生命值", "100"]]
  }
};
await AutoCardUpdaterAPI.importTemplateFromData(template, {
  scope: 'global', presetName: '标准模板'
});
await AutoCardUpdaterAPI.importTemplateFromData(template, {
  scope: 'chat', presetName: '任务专用模板'
});
```

### `getTableTemplate(options = {})`

获取当前表格模板。

| 参数                 | 类型     | 必填  | 默认值      | 说明  |
| ------------------ | ------ | --- | -------- | --- |
| options.scope      | string | 否   | `'chat'` | 作用域 |
| options.presetName | string | 否   | -        | 预设名 |

```javascript
const template = AutoCardUpdaterAPI.getTableTemplate({ scope: 'chat' });
if (template) {
  const sheetCount = Object.keys(template).filter(k => k.startsWith('sheet_')).length;
  console.log('模板包含', sheetCount, '张表');
}
```

---

## 剧情预设管理 API

管理"剧情推进"预设（即 AI 规划后续剧情的提示词模板），共 **10** 个方法。

### `getPlotPresets()`

获取所有剧情预设的完整数据。

**返回值**: `Array<Object>`

```javascript
const presets = AutoCardUpdaterAPI.getPlotPresets();
// 返回示例:
// [
//   { name: "默认预设", promptGroup: [...], rateMain: 1.0, ratePersonal: 1.0, rateErotic: 0, rateCuckold: 1.0, ... },
//   { name: "战斗场景", promptGroup: [...], rateMain: 1.2, ... }
// ]
```

### `getPlotPresetNames()`

获取所有剧情预设名称列表。

```javascript
const names = AutoCardUpdaterAPI.getPlotPresetNames();
// → ["默认预设", "战斗场景", "日常对话"]
```

### `getCurrentPlotPreset()`

获取当前使用的剧情预设名称。

```javascript
const current = AutoCardUpdaterAPI.getCurrentPlotPreset();
// → "默认预设" 或 ""
```

### `getPlotPresetDetails(presetName)`

获取指定预设的详细信息。

**返回值**: `Object | null`

```javascript
const details = AutoCardUpdaterAPI.getPlotPresetDetails("战斗场景");
if (details) {
  console.log("权重:", details.rateMain);
  console.log("提示词数:", details.promptGroup.length);
}

// 返回结构:
// {
//   name: "预设名称",
//   promptGroup: [
//     { role: "system", content: "...", enabled: true, mainSlot: "A" }
//   ],
//   finalSystemDirective: "最终系统指令",
//   rateMain: 1.0, ratePersonal: 1.0, rateErotic: 0, rateCuckold: 1.0,
//   extractTags: "",
//   minLength: 0,
//   contextTurnCount: 3,
//   loopSettings: { quickReplyContent: "", loopTags: "", loopDelay: 5, loopTotalDuration: 0, maxRetries: 3 }
// }
```

### `switchPlotPreset(presetName)`

切换到指定剧情预设。

```javascript
const success = AutoCardUpdaterAPI.switchPlotPreset("战斗场景");
```

### `injectPlotPresetToCurrentChat(presetName)`

将指定预设注入当前聊天。

```javascript
AutoCardUpdaterAPI.injectPlotPresetToCurrentChat("战斗场景");
```

### `importPlotPresetFromData(presetData, options = {})`

从数据对象导入单个剧情预设。

| 参数                | 类型      | 必填  | 默认值     | 说明        |
| ----------------- | ------- | --- | ------- | --------- |
| presetData        | object  | 是   | -       | 预设数据      |
| options.overwrite | boolean | 否   | `false` | 是否覆盖同名    |
| options.switchTo  | boolean | 否   | `false` | 导入后是否立即切换 |

```javascript
const result = await AutoCardUpdaterAPI.importPlotPresetFromData({
  name: "战斗场景预设",
  promptGroup: [{ role: "system", content: "你是战斗场景的规划师...", enabled: true }],
  rateMain: 1.2, ratePersonal: 0.8, rateErotic: 0
}, { overwrite: false, switchTo: true });
if (result.success) console.log('预设 "' + result.presetName + '" 导入成功');
```

### `importPlotPresetsFromData(presetsArray, options = {})`

批量导入多个剧情预设。

```javascript
const result = await AutoCardUpdaterAPI.importPlotPresetsFromData([
  { name: "战斗预设", promptGroup: [...], rateMain: 1.2 },
  { name: "日常预设", promptGroup: [...], rateMain: 1.0 }
], { overwrite: false });
console.log('成功', result.imported, '个，失败', result.failed, '个');
result.details.forEach((d, i) => console.log('预设' + (i+1) + ':', d.success ? d.presetName : d.message));
```

### `exportAllPlotPresets()`

导出所有剧情预设。

```javascript
const all = AutoCardUpdaterAPI.exportAllPlotPresets();
const json = JSON.stringify(all, null, 2);
```

### `initGameSession(characterData, options = {})`

初始化游戏会话。新角色卡首次启动时写入初始数据。

**返回值**: `Promise<Object>` — 包含各步骤执行状态的对象

```javascript
// 返回值结构:
// {
//   success: false,
//   templateInjected: false,
//   presetLoaded: false,
//   protagonistInitialized: false,
//   equipmentInitialized: false,
//   message: ''
// }
```

**参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| characterData | object | 是 | - | 角色数据（至少包含 `name`） |
| options | object | 否 | `{}` | 会话选项 |

**options 支持**:
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| injectTemplate | boolean | `true` | 是否注入数据库模板到首楼 |
| resetExistingTableData | boolean | `true` | 是否重置已有表格数据再注入 |
| loadPreset | boolean | `false` | 是否加载剧情预设 |
| templateData | object | - | 自定义模板数据（不传则从服务器加载默认模板） |
| templatePresetName | string | - | 模板预设名（默认用角色名） |

```javascript
await AutoCardUpdaterAPI.initGameSession({ name: '示例角色' }, {
  injectTemplate: true,
  loadPreset: false,
  templateData: { mate: {...}, sheet_0: {...} },
  templatePresetName: '示例角色'
});
```

---

## 数据管理 API

模板/设置导入导出、TXT 导入链路、可视化编辑器等，共 **19** 个方法。

### 模板与设置（7 个）

### `importTemplate(options = {})` / `exportTemplate(options = {})`

弹出文件对话框导入/导出模板预设。

### `resetTemplate(options = {})`

重置模板预设为默认值。

### `resetAllDefaults()`

重置所有设置为默认值。

### `exportJsonData()`

弹出保存对话框，导出当前 JSON 数据到文件。

### `importCombinedSettings()` / `exportCombinedSettings()`

弹出文件对话框导入/导出组合设置。

### `overrideWithTemplate()`

用当前模板覆盖已有数据。

### `migrateLegacyVectorIndex()`

迁移旧版向量索引到新格式。

### `openVisualizer()`

打开可视化表格编辑器。

```javascript
await AutoCardUpdaterAPI.openVisualizer();
```

### TXT 导入链路（6 个）

用于导入 TXT 文件并分割为世界书条目。

| 方法                         | 说明         |
| -------------------------- | ---------- |
| `importTxtAndSplit()`      | 导入 TXT 并分割 |
| `injectImportedSelected()` | 注入选中的导入内容  |
| `injectImportedStandard()` | 标准方式注入     |
| `injectImportedSummary()`  | 摘要方式注入     |
| `injectImportedFull()`     | 完整方式注入     |
| `deleteImportedEntries()`  | 删除已注入的导入条目 |

### 导入缓存管理（3 个）

| 方法                                      | 参数      | 说明     |
| --------------------------------------- | ------- | ------ |
| `clearImportedEntries(clearAll = true)` | boolean | 清空导入记录 |
| `clearImportCache(clearAll = true)`     | boolean | 清空导入缓存 |
| `mergeSummaryNow()`                     | -       | 立即合并摘要 |

---

## 设置与配置 API

管理数据库脚本的运行参数，共 **26** 个方法（v7.0 新增 10 个 Agent 相关方法）。

### 面板控制

| 方法                 | 说明       |
| ------------------ | -------- |
| `openSettings()`   | 打开设置面板   |
| `openVisualizer()` | 打开可视化编辑器 |
| `manualUpdate()`   | 立即手动更新   |

```javascript
await AutoCardUpdaterAPI.manualUpdate();
```

### 更新配置参数

### `getUpdateConfigParams()`

获取当前更新配置。

**返回值**:

```javascript
{
  autoUpdateThreshold: 3,       // 自动更新阈值（消息层数）
  autoUpdateFrequency: 1,       // 自动更新频率（每N层更新一次）
  updateBatchSize: 2,           // 批处理大小
  autoUpdateTokenThreshold: 0   // Token 阈值（0=不限制）
}
```

```javascript
const config = AutoCardUpdaterAPI.getUpdateConfigParams();
console.log('当前阈值:', config.autoUpdateThreshold);
```

### `setUpdateConfigParams(params)`

设置更新配置参数。

```javascript
AutoCardUpdaterAPI.setUpdateConfigParams({
  autoUpdateThreshold: 5,
  updateBatchSize: 3
});
```

### 手动更新表选择

### `getManualSelectedTables()`

获取手动选择的更新表列表。

**返回值**:

```javascript
{ selectedTables: ['sheet_xxx', 'sheet_yyy'], hasManualSelection: true }
```

### `setManualSelectedTables(sheetKeys)`

设置手动选择的表。

### `clearManualSelectedTables()`

清空手动选择。

```javascript
AutoCardUpdaterAPI.setManualSelectedTables(['sheet_abc123', 'sheet_def456']);
AutoCardUpdaterAPI.clearManualSelectedTables();
```

### API 预设管理（8 个）

管理数据库脚本内部使用的 AI API 配置。

### `getApiPresets()`

获取所有 API 预设。

**返回值**:

```javascript
[
  {
    name: '预设名称',
    apiMode: 'custom',            // 或 'tavern'
    apiConfig: {                  // custom 模式下的配置
      customApiUrl: 'https://...',
      customApiKey: ***
      customApiModel: 'gpt-4'
    },
    tavernProfile: ''             // tavern 模式下的配置文件名
  }
]
```

```javascript
const presets = AutoCardUpdaterAPI.getApiPresets();
console.log('可用预设:', presets.map(p => p.name));
```

### `getTableApiPreset()` / `setTableApiPreset(presetName)`

获取/设置表格更新使用的 API 预设。

```javascript
const preset = AutoCardUpdaterAPI.getTableApiPreset();
AutoCardUpdaterAPI.setTableApiPreset('战斗场景API'); // 切换
AutoCardUpdaterAPI.setTableApiPreset('');              // 恢复使用当前配置
```

### `getPlotApiPreset()` / `setPlotApiPreset(presetName)`

获取/设置剧情预设使用的 API 预设。

### `saveApiPreset(presetData)`

保存当前 API 配置为预设。

```javascript
AutoCardUpdaterAPI.saveApiPreset({
  name: '测试预设',
  apiMode: 'custom',
  apiConfig: {
    customApiUrl: 'https://api.example.com/v1',
    customApiKey: ***
    customApiModel: 'gpt-4o'
  },
  tavernProfile: ''
});
```

### `loadApiPreset(presetName)`

加载指定 API 预设。

```javascript
const success = AutoCardUpdaterAPI.loadApiPreset('测试预设');
if (success) console.log('预设已应用到当前配置');
```

### `deleteApiPreset(presetName)`

删除指定 API 预设。

### Agent 控制相关（v7.0 新增，10 个）

v7.0 新增的 Agent 世界书控制功能。支持 Agent 决策上下文设置、决策提示分段、Skillify 提示分段的管理。

### `getAgentPromptConfig()`

获取 Agent 相关的完整提示配置（一次性获取所有 Agent 配置）。

**返回值**: `Object`

```javascript
{
  contextSettings: {
    decisionRecentContextCharLimit: 2,        // 决策参考的最近 AI 回复层数，1 层 = 1 次 AI 回复 + 前一条用户输入
    decisionPreviousPlotCharLimit: 1,         // (已弃用) 保留向后兼容
    decisionWorldbookContentPreviewLimit: 1000, // (已弃用) 保留向后兼容
    decisionWorldbookCandidateLimit: 100,      // 决策时扫描的最大世界书候选数
    skillifyContentPreviewLimit: 1200,         // (已弃用) 保留向后兼容
    skillifyMaxEntries: 100,                   // Skillify 最大条目数
    plotWorldbookScanMessageLimit: 3,          // 剧情世界书扫描消息上限
    agentAiMaxRetries: 2,                      // Agent AI 调用最大重试次数
    greenlightMinTkBudget: 20000,              // Greenlight 最小 Token 预算
    greenlightMaxTkBudget: 80000               // Greenlight 最大 Token 预算
  },
  agentDecisionPromptSegments: [               // Agent 决策提示分段
    { role: "system", content: "...", deletable: true }
  ],
  agentSkillifyPromptSegments: [               // Agent Skillify 提示分段
    { role: "system", content: "...", deletable: true }
  ]
}
```

### `getAgentContextSettings()`

获取当前 Agent 上下文设置项。

**返回值**: `Object` — 各字段及默认值如上 `contextSettings` 所示

### `setAgentContextSettings(patch)`

设置 Agent 上下文设置。只更新 patch 中包含的字段。

| 参数    | 类型     | 必填  | 说明                 |
| ------- | ------- | ---- | -------------------- |
| patch   | object  | 是   | 要更新的字段，如 `{ decisionRecentContextCharLimit: 5 }` |

**返回值**: `boolean` — 是否成功

```javascript
AutoCardUpdaterAPI.setAgentContextSettings({
  decisionRecentContextCharLimit: 5,
  decisionWorldbookCandidateLimit: 150
});
```

### `resetAgentContextSettings()`

重置 Agent 上下文设置为默认值。

**返回值**: `boolean`

### `getAgentDecisionPromptSegments()`

获取 Agent 决策提示分段。

**返回值**: `Array<{ role: string, content: string, deletable: boolean }>`

### `setAgentDecisionPromptSegments(segments)`

设置 Agent 决策提示分段。

| 参数       | 类型    | 必填  | 说明               |
| ---------- | ------- | ---- | ------------------ |
| segments   | Array   | 是   | 提示分段数组，每项含 `role`、`content`、`deletable` |

**返回值**: `boolean`

```javascript
AutoCardUpdaterAPI.setAgentDecisionPromptSegments([
  { role: "system", content: "你是剧情决策助手。", deletable: false },
  { role: "system", content: "请根据当前剧情推进决策。", deletable: true }
]);
```

### `resetAgentDecisionPromptSegments()`

重置 Agent 决策提示分段为默认值。

**返回值**: `boolean`

### `getAgentSkillifyPromptSegments()`

获取 Agent Skillify 提示分段。

**返回值**: `Array<{ role: string, content: string, deletable: boolean }>`

### `setAgentSkillifyPromptSegments(segments)`

设置 Agent Skillify 提示分段。

| 参数       | 类型    | 必填  | 说明               |
| ---------- | ------- | ---- | ------------------ |
| segments   | Array   | 是   | 提示分段数组 |

**返回值**: `boolean`

```javascript
AutoCardUpdaterAPI.setAgentSkillifyPromptSegments([
  { role: "system", content: "你是 Skillify 生成助手。", deletable: false }
]);
```

### `resetAgentSkillifyPromptSegments()`

重置 Agent Skillify 提示分段为默认值。

**返回值**: `boolean`

---

## 世界书与 AI API

世界书同步、AI 调用、正文优化、Skill 元数据等，共 **11** 个方法（v7.0 新增 2 个世界书 Skill 元数据方法）。

### `syncWorldbookEntries({ createIfNeeded = true } = {})`

立即同步世界书注入条目。

| 参数             | 类型      | 必填  | 默认值    | 说明         |
| -------------- | ------- | --- | ------ | ---------- |
| createIfNeeded | boolean | 否   | `true` | 条目不存在时是否创建 |

```javascript
await AutoCardUpdaterAPI.syncWorldbookEntries({ createIfNeeded: true });
```

### `refreshDataAndWorldbook()`

强制刷新数据并重新注入世界书。

**使用场景**：通过 `updateRow`/`insertRow`/`deleteRow` 修改表格数据后，确保世界书同步。

```javascript
await AutoCardUpdaterAPI.updateRow('主角信息', 1, { '力量': 15 });
await AutoCardUpdaterAPI.refreshDataAndWorldbook();
```

### `reoptimizeMessage(messageIndex)`

重新优化指定消息的内容。

| 参数           | 类型     | 必填  | 说明        |
| ------------ | ------ | --- | --------- |
| messageIndex | number | 是   | 消息索引（楼层号） |

### `cancelContentOptimization(reason)`

取消正在进行的正文优化。

| 参数     | 类型     | 必填  | 默认值             | 说明   |
| ------ | ------ | --- | --------------- | ---- |
| reason | string | 否   | `'正文优化已由用户终止。'` | 取消原因 |

### `deleteInjectedEntries()`

删除当前世界书中所有由本插件生成的条目。

### `setOutlineEntryEnabled(enabled)`

启用/禁用总结大纲条目。

### `setZeroTkOccupyMode(modeEnabled)`

设置 0TK 占用模式：`true`=禁用世界书条目以节省 token，`false`=启用。

### `getWorldbookEntrySkillMeta(bookName, uid)`（v7.0 新增）

读取指定世界书条目的 Skill 元数据。Skill 元数据存储在世界书条目的 comment block 中，外部插件不需要解析内部格式。

| 参数       | 类型            | 必填 | 说明                   |
| --------- | --------------- | ---- | ---------------------- |
| bookName  | string          | 是   | 世界书名称（书名）         |
| uid       | number \| string | 是   | 条目的 uid               |

**返回值**: `Object | null`

```javascript
const meta = await AutoCardUpdaterAPI.getWorldbookEntrySkillMeta("我的世界书", 12345);
if (meta) {
  console.log("技能标签:", meta.label);
  console.log("元数据:", meta.skillMeta);
}

// 返回值结构:
// {
//   bookName: "我的世界书",
//   uid: 12345,
//   comment: "...",          // 原始 comment 文本
//   label: "条目 12345",     // 去除了 skill meta block 后的标签
//   skillMeta: { ... }       // 解析后的 Skill 元数据（内部格式）
// }
```

### `listWorldbookSkillMetas(bookNames = [])`（v7.0 新增）

批量列出世界书中已保存的 Skill 元数据。便于用户分享世界书后由插件读取。

| 参数        | 类型               | 必填 | 默认值 | 说明                                   |
| ----------- | ------------------ | ---- | ------ | -------------------------------------- |
| bookNames   | string[] \| string | 否   | `[]`  | 世界书名称列表（支持逗号/中文逗号/换行分隔的字符串） |

**返回值**: `Array<Object>`

```javascript
// 查询多个世界书
const metas = await AutoCardUpdaterAPI.listWorldbookSkillMetas(["我的世界书", "战斗世界书"]);
console.log("共找到", metas.length, "条 Skill 元数据");

// 支持逗号分隔字符串
const metas2 = await AutoCardUpdaterAPI.listWorldbookSkillMetas("我的世界书, 战斗世界书");
```

### `callAI(messages, options = {})`

直接调用 AI，绕过酒馆生成管道，使用数据库脚本内部配置的 API。

**参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| messages | Array | 是 | - | 消息数组 `[{ role, content }]` |
| options.presetName | string | 否 | `''` | API 预设名，空字符串用当前配置 |
| options.max_tokens | number | 否 | 配置值 | 最大 token 数（也接受 `maxTokens`） |
| options.maxTokens | number | 否 | 配置值 | `max_tokens` 的别名 |

**返回值**: `Promise<string | null>` - AI 回复文本

> 注：此方法使用数据库脚本内部的 API 配置，**不携带酒馆预设中的提示词**。底层支持 custom API 和 tavern API 两种模式，自动根据配置路由。

```javascript
// 基础调用
const reply = await AutoCardUpdaterAPI.callAI([
  { role: 'system', content: '你是一个有帮助的助手。' },
  { role: 'user', content: '请生成一个奇幻场景的描述。' }
], { max_tokens: 2000 });

// 指定预设
const reply2 = await AutoCardUpdaterAPI.callAI(messages, { presetName: '默认' });

// 配合 getStoryContext 使用
const context = AutoCardUpdaterAPI.getStoryContext(5);
const analysis = await AutoCardUpdaterAPI.callAI([
  { role: 'system', content: '你是剧情分析助手。' },
  { role: 'user', content: '请分析以下剧情的发展趋势：\n\n' + context }
]);
```

### `getStoryContext(maxTurns = 3)`

获取最近几轮 AI 消息作为剧情上下文。

```javascript
const context = AutoCardUpdaterAPI.getStoryContext(5);
// 返回最近 5 条 AI 消息，用换行拼接
```

---

## SQL 查询 API

以 SQL 方式直接查询表格数据，共 **7** 个方法（v7.0 新增 `mapValue` 内部方法）。

> 所有方法中的 `sqlOrOptions` 均支持两种形式：
>
> - `executeSqlQuery('SELECT * FROM table_name')`
> - `executeSqlQuery({ sql: 'SELECT * FROM table_name', params: [] })`

### `executeSqlQuery(sqlOrOptions, params, options)`

执行 SQL 查询（仅允许 SELECT/PRAGMA/EXPLAIN/WITH 等只读语句）。

| 参数            | 类型               | 必填  | 说明              |
| ------------- | ---------------- | --- | --------------- |
| sqlOrOptions  | string \| object | 是   | SQL 或选项         |
| params        | Array            | 否   | SQL 参数（`?` 占位符） |
| options.limit | number           | 否   | 最大行数            |

```javascript
const result = AutoCardUpdaterAPI.executeSqlQuery(
  'SELECT * FROM sheet_data WHERE 好感度 > ?', [80], { limit: 5 }
);
```

### `querySql(sqlOrOptions, params, options)`

`executeSqlQuery` 的别名。

### `queryTableRows(options = {})`

以键名查询表格数据行，最常用的 SQL 查询方式。

| 参数                | 类型     | 必填  | 默认值     | 说明     |
| ----------------- | ------ | --- | ------- | ------ |
| options.tableName | string | 是   | -       | 表格名称   |
| options.columns   | Array  | 否   | `['*']` | 要查询的列名 |
| options.where     | string | 否   | -       | 过滤条件   |
| options.orderBy   | string | 否   | -       | 排序字段   |
| options.limit     | number | 否   | -       | 最大行数   |

```javascript
const rows = AutoCardUpdaterAPI.queryTableRows({
  tableName: '重要人物表',
  columns: ['姓名', '好感度', '状态'],
  orderBy: '好感度 DESC',
  limit: 10
});

const weapons = AutoCardUpdaterAPI.queryTableRows({
  tableName: '重要物品表',
  where: "类型 = '武器' AND 数量 > 0",
  orderBy: '攻击力 DESC'
});
```

### `executeSqlMutation(sqlOrOptions, params, options)`

执行 SQL 变更（INSERT/UPDATE/DELETE）。

**返回值**: `Promise<Object>`

### `executeSqlBatch(sqlOrOptions, options)`

执行批量 SQL。

### `executeSql(sqlOrOptions, params, options)`

通用 SQL 入口，自动判断语句类型并路由到查询或变更路径。

---

## 综合工作流示例

以下示例展示将多个 API 组合使用的模式。

### 示例 1：监听数据更新并刷新技术文档

```javascript
const api = AutoCardUpdaterAPI;

api.registerTableUpdateCallback((data) => {
  // 每次表格更新时，提取所有表名和结构
  const tables = {};
  for (const key in data) {
    if (key.startsWith('sheet_') && data[key]?.name) {
      const sheet = data[key];
      tables[sheet.name] = {
        columns: sheet.content[0] || [],
        rowCount: sheet.content.length - 1
      };
    }
  }
  console.log('当前表格结构:', tables);
});
```

### 示例 2：备份与恢复预设

```javascript
const api = AutoCardUpdaterAPI;

// 备份所有剧情预设到 localStorage
function backup() {
  const all = api.exportAllPlotPresets();
  localStorage.setItem('presets_backup', JSON.stringify(all));
  console.log('已备份', all.length, '个预设');
}

// 从备份恢复
async function restore() {
  const raw = localStorage.getItem('presets_backup');
  if (!raw) return;
  await api.importPlotPresetsFromData(JSON.parse(raw), { overwrite: true });
}
```

### 示例 3：SQL 查询实现跨表统计

```javascript
const api = AutoCardUpdaterAPI;

// 使用 SQL API 查询
const highAffinity = api.queryTableRows({
  tableName: '重要人物表',
  columns: ['姓名', '好感度', '所在地点'],
  where: '好感度 >= 80',
  orderBy: '好感度 DESC'
});

// 使用回调监听 + 自动刷新统计
api.registerTableUpdateCallback(() => {
  const stats = api.executeSqlQuery(
    'SELECT 所在地点, COUNT(*) as 人数 FROM sheet_data GROUP BY 所在地点'
  );
  console.log('各地区人数分布:', stats);
});
```

### 示例 4：读取世界书 Skill 元数据（v7.0 新增）

```javascript
const api = AutoCardUpdaterAPI;

// 读取单个条目的 Skill 元数据
const skillMeta = await api.getWorldbookEntrySkillMeta("我的世界书", 12345);
if (skillMeta) {
  console.log(`条目 "${skillMeta.label}" 的 Skill 元数据:`, skillMeta.skillMeta);
}

// 批量扫描世界书中的所有 Skill 元数据
const allMetas = await api.listWorldbookSkillMetas(["人物世界书", "战斗世界书"]);
allMetas.forEach(meta => {
  console.log(`[${meta.bookName}] #${meta.uid} ${meta.label}`);
});
```

### 示例 5：配置 Agent 行为（v7.0 新增）

```javascript
const api = AutoCardUpdaterAPI;

// 获取完整 Agent 提示配置
const config = api.getAgentPromptConfig();
console.log("当前 Agent 配置:", config);

// 调整 Agent 决策的参考层数
api.setAgentContextSettings({
  decisionRecentContextCharLimit: 5,
  decisionWorldbookCandidateLimit: 200
});

// 自定义 Agent 决策提示
api.setAgentDecisionPromptSegments([
  { role: "system", content: "你是一位资深剧情策划。", deletable: false },
  { role: "system", content: "请根据当前剧情状态，自动推进故事发展。", deletable: true }
]);
```

---

## AutoCardUpdaterV2API（新版 V2 界面）

通过全局对象 `window.AutoCardUpdaterV2API` 访问。

| 方法 | 说明 |
|------|------|
| `open()` | 打开 V2 界面壳层 |
| `openVisualizer()` | 打开可视化编辑器（指定来源为 external-api） |
| `refreshVisualizer()` | 请求可视化编辑器外部刷新 |

```javascript
// 打开 V2 界面
window.AutoCardUpdaterV2API.open();

// 打开可视化表格编辑器
window.AutoCardUpdaterV2API.openVisualizer();

// 刷新可视化编辑器
window.AutoCardUpdaterV2API.refreshVisualizer();
```

---

## 版本变化总结

### v5.5.7 → v7.0 变化概览

| 分组 | v5.5.7 | v7.0 | 变化 |
|------|--------|------|------|
| 回调注册 API | 5 | 5 | ✓ 不变 |
| 核心数据 API | 4 | 4 | ✓ 不变 |
| 表格 CRUD API | 4 | 6 | +2 新增 `mapValue`、`validate`（内部辅助） |
| 表格锁定 API | 11 | 11 | ✓ 不变 |
| 模板预设 API | 5 | 5 | ✓ 不变 |
| 剧情预设管理 API | 10 | 10 | ✓ 不变 |
| 数据管理 API | 19 | 19 | ✓ 不变 |
| 设置与配置 API | 16 | **26** | **+10！** |
| 世界书与 AI API | 9 | **11** | **+2** |
| SQL 查询 API | 6 | 7 | +1 新增 `mapValue`（内部辅助） |
| **总计** | **89** | **104** | **+15** |

### 重要新增功能

1. **🧠 Agent 世界书控制（10 个新方法）** — 设置与配置 API 分组
   - `getAgentPromptConfig()` — 获取完整 Agent 提示配置
   - `getAgentContextSettings()` / `setAgentContextSettings(patch)` / `resetAgentContextSettings()` — 上下文设置
   - `getAgentDecisionPromptSegments()` / `setAgentDecisionPromptSegments(segments)` / `resetAgentDecisionPromptSegments()` — 决策提示分段
   - `getAgentSkillifyPromptSegments()` / `setAgentSkillifyPromptSegments(segments)` / `resetAgentSkillifyPromptSegments()` — Skillify 提示分段

2. **📖 世界书 Skill 元数据（2 个新方法）** — 世界书与 AI API 分组
   - `getWorldbookEntrySkillMeta(bookName, uid)` — 读取单条目 Skill 元数据
   - `listWorldbookSkillMetas(bookNames)` — 批量列出世界书 Skill 元数据

3. **🛠 内部辅助方法（3 个）** — 对外接口影响很小，主要为 SQLite 模式下的回调验证
   - `mapValue()`（TableCrudApi）、`validate()`（TableCrudApi）、`mapValue()`（SqlApi）
