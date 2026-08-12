# Live2D IndexedDB 写入端接口文档

## 1. 目标

实现一个 Live2D IndexedDB 写入端，用于把 Live2D Cubism2 模型资源写入浏览器 IndexedDB，并返回现有前端渲染链路可直接使用的数据。

当前渲染链路：

```text
写入端
-> IndexedDB
-> l2d-indexeddb-loader.js
-> Blob URL
-> l2d-pixi-runtime.js
-> Pixi Live2D 渲染
```

写入端只负责：

1. 校验模型资源；
2. 写入 IndexedDB；
3. 返回 `adjutant.live2d` 配置；
4. 返回 manifest 供调试、缓存和排查使用。

写入端不负责直接渲染 Live2D。

---

## 2. IndexedDB 固定契约

### 2.1 Database

```ts
databaseName: "gfl-live2d-assets"
```

必填，固定值。

### 2.2 Object Store

```ts
storeName: "assets"
```

必填，固定值。

### 2.3 Resource Key 格式

```text
<dir>/<state>/<relativePath>
```

示例：

```text
dsr50_1801/normal/model.json
dsr50_1801/normal/model.moc
dsr50_1801/normal/model.1024/texture_00.png
dsr50_1801/normal/motions/touch_1.mtn
dsr50_1801/destroy/model.json
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `dir` | `string` | 是 | 模型 ID，例如 `dsr50_1801` |
| `state` | `"normal" \| "destroy"` | 是 | 模型状态 |
| `relativePath` | `string` | 是 | 相对于当前状态目录的资源路径，必须和 `model.json` 内引用完全一致 |

---

## 3. 主写入接口

```ts
async function writeLive2DPackage(
  input: Live2DWriteInput
): Promise<Live2DWriteResult>;
```

---

## 4. 输入结构

### 4.1 `Live2DWriteInput`

```ts
interface Live2DWriteInput {
  dir: string;
  name?: string;
  states: {
    normal: Live2DStateInput;
    destroy?: Live2DStateInput;
  };
  options?: Live2DWriteOptions;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `dir` | `string` | 是 | 模型 ID，也是 IndexedDB key 前缀 |
| `name` | `string` | 否 | 显示名，例如 `DSR-50` |
| `states.normal` | `Live2DStateInput` | 是 | 普通状态资源 |
| `states.destroy` | `Live2DStateInput` | 否 | 大破状态资源 |
| `options` | `Live2DWriteOptions` | 否 | 写入选项 |

---

### 4.2 `Live2DStateInput`

```ts
interface Live2DStateInput {
  files: Record<string, Live2DFileValue>;
}
```

`files` 的 key 是相对于当前状态目录的路径。

示例：

```ts
{
  files: {
    "model.json": modelJsonBlob,
    "model.moc": mocBlob,
    "model.1024/texture_00.png": textureBlob,
    "motions/daiji_idle_01.mtn": idleMotionBlob,
    "motions/touch_1.mtn": touchMotionBlob,
    "physics.json": physicsBlob
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `files` | `Record<string, Live2DFileValue>` | 是 | 当前状态下的全部资源文件 |
| `files["model.json"]` | `Live2DFileValue` | 是 | 当前状态的 Live2D 配置文件 |
| `files["model.moc"]` | `Live2DFileValue` | 是，如果 `model.json.model` 指向它 | Live2D 模型文件 |
| `files["...png"]` | `Live2DFileValue` | 是，如果 `textures` 引用 | 贴图 |
| `files["...mtn"]` | `Live2DFileValue` | 是，如果 `motions` 或 `gfl_touch_motions` 引用 | 动作 |
| `files["physics.json"]` | `Live2DFileValue` | 是，如果 `physics` 引用 | 物理配置 |
| `files["pose.json"]` | `Live2DFileValue` | 是，如果 `pose` 引用 | 姿态配置 |
| `files["expressions/..."]` | `Live2DFileValue` | 是，如果 `expressions` 引用 | 表情配置 |

---

### 4.3 `Live2DFileValue`

```ts
type Live2DFileValue =
  | Blob
  | File
  | ArrayBuffer
  | Uint8Array
  | string
  | {
      data: Blob | File | ArrayBuffer | Uint8Array | string;
      mime?: string;
      size?: number;
      sha256?: string;
    };
```

推荐写入端内部统一转成：

```ts
Blob
```

不要把多种格式原样塞进 IndexedDB。兼容分支越多，出错点越多。

---

### 4.4 `Live2DWriteOptions`

```ts
interface Live2DWriteOptions {
  overwrite?: boolean;
  writeMeta?: boolean;
  validateStrict?: boolean;
}
```

字段说明：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---:|---:|---|
| `overwrite` | `boolean` | 否 | `true` | 是否覆盖已有资源 |
| `writeMeta` | `boolean` | 否 | `true` | 是否写入 `meta/<dir>/version` |
| `validateStrict` | `boolean` | 否 | `true` | 是否严格校验资源完整性 |

---

## 5. `model.json` 字段要求

### 5.1 必填字段

```ts
interface Live2DModelJsonRequired {
  model: string;
  textures: string[];
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `model` | `string` | 是 | `.moc` 文件路径，相对于当前 state 目录 |
| `textures` | `string[]` | 是 | 贴图路径数组，相对于当前 state 目录 |

示例：

```json
{
  "model": "model.moc",
  "textures": [
    "model.1024/texture_00.png"
  ]
}
```

对应 IndexedDB 必须存在：

```text
<dir>/<state>/model.moc
<dir>/<state>/model.1024/texture_00.png
```

---

### 5.2 可选但推荐字段

```ts
interface Live2DModelJsonOptional {
  motions?: Record<string, Array<{ file: string; [key: string]: any }>>;
  physics?: string;
  pose?: string;
  expressions?: Array<{
    name?: string;
    file: string;
  }>;
  hit_areas?: Array<{
    name: string;
    id: string;
  }>;
  gfl_touch_motions?: Record<string, string[]>;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `motions` | `Record<string, Motion[]>` | 否，推荐 | 动作配置 |
| `motions[group][].file` | `string` | motions 内必填 | 动作文件路径 |
| `physics` | `string` | 否 | 物理配置路径 |
| `pose` | `string` | 否 | 姿态配置路径 |
| `expressions` | `Expression[]` | 否 | 表情配置 |
| `expressions[].file` | `string` | expressions 内必填 | 表情文件路径 |
| `hit_areas` | `HitArea[]` | 点击交互推荐必填 | 点击区域 |
| `hit_areas[].name` | `string` | hit area 内必填 | 区域名，例如 `body`、`face` |
| `hit_areas[].id` | `string` | hit area 内必填 | Live2D hit area ID |
| `gfl_touch_motions` | `Record<string, string[]>` | 点击动作推荐必填 | 项目自定义点击动作映射 |

---

## 6. 点击动作字段：`gfl_touch_motions`

`gfl_touch_motions` 是项目自定义字段，用于让 loader 生成 `tap_body`、`tap_face`、`tap_leg` 等点击动作组。

示例：

```json
{
  "hit_areas": [
    {
      "name": "face",
      "id": "D_REF.FACE"
    },
    {
      "name": "body",
      "id": "D_REF.BODY"
    },
    {
      "name": "leg",
      "id": "D_REF.LEG"
    }
  ],
  "motions": {
    "idle": [
      {
        "file": "motions/daiji_idle_01.mtn"
      }
    ],
    "": [
      {
        "file": "motions/touch_1.mtn"
      },
      {
        "file": "motions/touch_2.mtn"
      }
    ]
  },
  "gfl_touch_motions": {
    "face": [
      "motions/touch_1.mtn"
    ],
    "body": [
      "motions/touch_2.mtn"
    ],
    "leg": [
      "motions/touch_1.mtn"
    ]
  }
}
```

约束：

| 规则 | 必须 |
|---|---:|
| `gfl_touch_motions` 的 key 应与 `hit_areas[].name` 对应 | 是 |
| `gfl_touch_motions[area]` 必须是字符串数组 | 是 |
| 数组内路径必须存在于 `files` | 是 |
| 数组内路径必须也出现在 `motions` 的某个 group 中 | 是 |
| 如果点击需要 body fallback，建议至少提供 `body` | 是 |

错误示例：

```json
{
  "gfl_touch_motions": {
    "body": [
      "motions/touch_1.mtn"
    ]
  },
  "motions": {
    "idle": [
      {
        "file": "motions/daiji_idle_01.mtn"
      }
    ]
  }
}
```

问题：`motions/touch_1.mtn` 没出现在 `motions` 里，loader 无法生成 `tap_body`。

---

## 7. 写入端必须校验的资源引用

写入端必须从 `model.json` 收集以下引用：

```ts
interface CollectedReferences {
  model: string;
  textures: string[];
  motions: string[];
  expressions: string[];
  physics?: string;
  pose?: string;
  gflTouchMotions: string[];
}
```

收集规则：

| 来源字段 | 收集路径 |
|---|---|
| `model` | `.moc` 路径 |
| `textures[]` | 所有贴图路径 |
| `motions[group][].file` | 所有动作路径 |
| `expressions[].file` | 所有表情路径 |
| `physics` | 物理配置路径 |
| `pose` | 姿态配置路径 |
| `gfl_touch_motions[area][]` | 所有触摸动作路径 |

---

## 8. 校验规则

### 8.1 normal 状态

| 校验项 | 必须 |
|---|---:|
| `states.normal` 存在 | 是 |
| `states.normal.files["model.json"]` 存在 | 是 |
| `model.json.model` 存在 | 是 |
| `model.json.model` 对应文件存在 | 是 |
| `model.json.textures` 是非空数组 | 是 |
| 每个 texture 对应文件存在 | 是 |
| `motions` 中声明的 motion 文件存在 | 是，严格模式 |
| `physics` 对应文件存在 | 如果声明则是 |
| `pose` 对应文件存在 | 如果声明则是 |
| `expressions[].file` 对应文件存在 | 如果声明则是 |
| `gfl_touch_motions` 中声明的文件存在 | 如果声明则是 |
| `gfl_touch_motions` 中声明的文件能在 `motions` 中找到 | 如果声明则是 |

---

### 8.2 destroy 状态

`destroy` 状态可选。

| 情况 | 行为 |
|---|---|
| 没有 `states.destroy` | 合法，渲染端会使用 normal 作为 damaged 状态 |
| 有 `states.destroy` | 必须完整校验 |
| 有 `destroy/model.json` 但缺关键资源 | 必须报错 |
| destroy 半残 | 不允许静默通过 |

---

## 9. IndexedDB 写入规则

### 9.1 资源写入 key

对每个 state 的每个文件：

```ts
const key = `${dir}/${state}/${relativePath}`;
```

示例：

```ts
store.put(blob, "dsr50_1801/normal/model.json");
store.put(blob, "dsr50_1801/normal/model.moc");
store.put(blob, "dsr50_1801/normal/model.1024/texture_00.png");
```

---

### 9.2 meta key

写入端应写入版本信息：

```text
meta/<dir>/version
```

示例：

```text
meta/dsr50_1801/version
```

value：

```ts
string
```

例如：

```text
6fe700e7ecb30e0d
```

---

### 9.3 写入顺序

必须按以下顺序：

```text
1. 校验 input 基本结构
2. 解析 normal/model.json
3. 收集 normal 资源引用
4. 校验 normal 资源完整性
5. 如果有 destroy，解析 destroy/model.json
6. 收集 destroy 资源引用
7. 校验 destroy 资源完整性
8. 计算 version
9. 写入所有资源 Blob
10. 最后写入 meta/<dir>/version
11. 返回结果
```

禁止先写 meta 再写资源。meta 代表资源已完整可用，不能提前写。

---

## 10. 输出结构

### 10.1 `Live2DWriteResult`

```ts
type Live2DWriteResult = Live2DWriteSuccessResult | Live2DWriteErrorResult;
```

```ts
interface Live2DWriteSuccessResult {
  ok: true;
  adjutant: Live2DAdjutantConfig;
  manifest: Live2DWriteManifest;
}
```

---

### 10.2 `Live2DAdjutantConfig`

这是给 `standby.html` 使用的配置。

```ts
interface Live2DAdjutantConfig {
  name?: string;
  live2d: {
    dir: string;
    jsonPath: string;
    version: string;
    hasDestroy: boolean;
  };
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `name` | `string` | 否 | 显示名 |
| `live2d` | `object` | 是 | Live2D 配置 |
| `live2d.dir` | `string` | 是 | IndexedDB 模型 ID |
| `live2d.jsonPath` | `string` | 是 | 占位路径，建议用 `indexeddb://<dir>/normal/model.json` |
| `live2d.version` | `string` | 是 | 写入版本 |
| `live2d.hasDestroy` | `boolean` | 是 | 是否写入 destroy 状态 |

示例：

```json
{
  "name": "DSR-50",
  "live2d": {
    "dir": "dsr50_1801",
    "jsonPath": "indexeddb://dsr50_1801/normal/model.json",
    "version": "6fe700e7ecb30e0d",
    "hasDestroy": true
  }
}
```

注意：

`jsonPath` 在这里是占位字段。当前 `standby.html` 用它判断是否存在 Live2D 配置。真正渲染时，`l2d-indexeddb-loader.js` 会把它替换成 Blob URL。

---

### 10.3 `Live2DWriteManifest`

```ts
interface Live2DWriteManifest {
  dir: string;
  name?: string;
  version: string;
  databaseName: "gfl-live2d-assets";
  storeName: "assets";
  states: {
    normal: Live2DStateManifest;
    destroy?: Live2DStateManifest;
  };
  assets: Live2DAssetManifest[];
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `dir` | `string` | 是 | 模型 ID |
| `name` | `string` | 否 | 显示名 |
| `version` | `string` | 是 | 资源版本 |
| `databaseName` | `"gfl-live2d-assets"` | 是 | IndexedDB database |
| `storeName` | `"assets"` | 是 | IndexedDB object store |
| `states.normal` | `Live2DStateManifest` | 是 | normal 状态写入结果 |
| `states.destroy` | `Live2DStateManifest` | 否 | destroy 状态写入结果 |
| `assets` | `Live2DAssetManifest[]` | 是 | 全部写入资源清单 |

---

### 10.4 `Live2DStateManifest`

```ts
interface Live2DStateManifest {
  state: "normal" | "destroy";
  modelJsonKey: string;
  assetCount: number;
  requiredAssetCount: number;
  optionalAssetCount: number;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `state` | `"normal" \| "destroy"` | 是 | 状态名 |
| `modelJsonKey` | `string` | 是 | model.json 的 IndexedDB key |
| `assetCount` | `number` | 是 | 当前状态写入资源总数 |
| `requiredAssetCount` | `number` | 是 | 必需资源数量 |
| `optionalAssetCount` | `number` | 是 | 可选资源数量 |

---

### 10.5 `Live2DAssetManifest`

```ts
interface Live2DAssetManifest {
  key: string;
  state: "normal" | "destroy";
  relativePath: string;
  mime: string;
  size: number;
  sha256: string;
  required: boolean;
  kind:
    | "model-json"
    | "moc"
    | "texture"
    | "motion"
    | "physics"
    | "pose"
    | "expression"
    | "other";
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `key` | `string` | 是 | IndexedDB key |
| `state` | `"normal" \| "destroy"` | 是 | 状态 |
| `relativePath` | `string` | 是 | 相对路径 |
| `mime` | `string` | 是 | MIME |
| `size` | `number` | 是 | 字节数 |
| `sha256` | `string` | 是 | 文件 hash |
| `required` | `boolean` | 是 | 是否必需 |
| `kind` | `string` | 是 | 资源类型 |

---

## 11. 成功输出示例

```json
{
  "ok": true,
  "adjutant": {
    "name": "DSR-50",
    "live2d": {
      "dir": "dsr50_1801",
      "jsonPath": "indexeddb://dsr50_1801/normal/model.json",
      "version": "6fe700e7ecb30e0d",
      "hasDestroy": true
    }
  },
  "manifest": {
    "dir": "dsr50_1801",
    "name": "DSR-50",
    "version": "6fe700e7ecb30e0d",
    "databaseName": "gfl-live2d-assets",
    "storeName": "assets",
    "states": {
      "normal": {
        "state": "normal",
        "modelJsonKey": "dsr50_1801/normal/model.json",
        "assetCount": 31,
        "requiredAssetCount": 18,
        "optionalAssetCount": 13
      },
      "destroy": {
        "state": "destroy",
        "modelJsonKey": "dsr50_1801/destroy/model.json",
        "assetCount": 28,
        "requiredAssetCount": 16,
        "optionalAssetCount": 12
      }
    },
    "assets": [
      {
        "key": "dsr50_1801/normal/model.json",
        "state": "normal",
        "relativePath": "model.json",
        "mime": "application/json",
        "size": 1931,
        "sha256": "abc...",
        "required": true,
        "kind": "model-json"
      },
      {
        "key": "dsr50_1801/normal/model.moc",
        "state": "normal",
        "relativePath": "model.moc",
        "mime": "application/octet-stream",
        "size": 123456,
        "sha256": "def...",
        "required": true,
        "kind": "moc"
      },
      {
        "key": "dsr50_1801/normal/model.1024/texture_00.png",
        "state": "normal",
        "relativePath": "model.1024/texture_00.png",
        "mime": "image/png",
        "size": 456789,
        "sha256": "ghi...",
        "required": true,
        "kind": "texture"
      }
    ]
  }
}
```

---

## 12. 错误输出结构

```ts
interface Live2DWriteErrorResult {
  ok: false;
  error: {
    code: Live2DWriteErrorCode;
    message: string;
    details?: any;
  };
}
```

```ts
type Live2DWriteErrorCode =
  | "INVALID_INPUT"
  | "MISSING_NORMAL_STATE"
  | "MISSING_MODEL_JSON"
  | "INVALID_MODEL_JSON"
  | "MISSING_MODEL_MOC"
  | "MISSING_TEXTURE"
  | "MISSING_MOTION"
  | "MISSING_PHYSICS"
  | "MISSING_POSE"
  | "MISSING_EXPRESSION"
  | "INVALID_TOUCH_MOTION_MAP"
  | "TOUCH_MOTION_NOT_IN_MOTIONS"
  | "INCOMPLETE_DESTROY_STATE"
  | "INDEXEDDB_UNAVAILABLE"
  | "INDEXEDDB_WRITE_FAILED";
```

错误示例：

```json
{
  "ok": false,
  "error": {
    "code": "TOUCH_MOTION_NOT_IN_MOTIONS",
    "message": "gfl_touch_motions.body 引用了 motions/touch_1.mtn，但该文件没有出现在 motions 中",
    "details": {
      "dir": "dsr50_1801",
      "state": "normal",
      "area": "body",
      "file": "motions/touch_1.mtn"
    }
  }
}
```

---

## 13. MIME 推断规则

```ts
function inferMime(relativePath: string): string {
  if (relativePath.endsWith(".json")) return "application/json";
  if (relativePath.endsWith(".exp")) return "application/json";
  if (relativePath.endsWith(".png")) return "image/png";
  if (relativePath.endsWith(".moc")) return "application/octet-stream";
  if (relativePath.endsWith(".mtn")) return "application/octet-stream";
  return "application/octet-stream";
}
```

---

## 14. Version 生成规则

推荐使用所有资源 sha256 聚合生成版本：

```ts
version = sha256(
  assets
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(a => `${a.key}:${a.sha256}`)
    .join("\n")
).slice(0, 16);
```

版本必须在资源写入成功后写入：

```text
meta/<dir>/version
```

示例：

```text
meta/dsr50_1801/version
```

---

## 15. 最小输入示例

```ts
await writeLive2DPackage({
  dir: "test_model",
  name: "测试模型",
  states: {
    normal: {
      files: {
        "model.json": new Blob([
          JSON.stringify({
            version: "Sample 1.0.0",
            model: "model.moc",
            textures: ["model.1024/texture_00.png"],
            motions: {
              idle: [
                { file: "motions/idle.mtn" }
              ]
            }
          })
        ], { type: "application/json" }),

        "model.moc": mocBlob,
        "model.1024/texture_00.png": textureBlob,
        "motions/idle.mtn": idleMotionBlob
      }
    }
  }
});
```

---

## 16. 完整交互输入示例

```ts
await writeLive2DPackage({
  dir: "dsr50_1801",
  name: "DSR-50",
  states: {
    normal: {
      files: {
        "model.json": modelJsonBlob,
        "model.moc": mocBlob,
        "model.1024/texture_00.png": textureBlob,
        "motions/daiji_idle_01.mtn": idleMotionBlob,
        "motions/touch_1.mtn": touch1Blob,
        "motions/touch_2.mtn": touch2Blob,
        "motions/touch_3.mtn": touch3Blob,
        "physics.json": physicsBlob
      }
    },
    destroy: {
      files: {
        "model.json": destroyModelJsonBlob,
        "model.moc": destroyMocBlob,
        "model.1024/texture_00.png": destroyTextureBlob
      }
    }
  },
  options: {
    overwrite: true,
    writeMeta: true,
    validateStrict: true
  }
});
```

---

## 17. 写入后给 standby 使用

写入成功后，可以把返回的 `adjutant` 写入：

```ts
localStorage.setItem("gfl-adjutant", JSON.stringify(result.adjutant));
```

示例：

```json
{
  "name": "DSR-50",
  "live2d": {
    "dir": "dsr50_1801",
    "jsonPath": "indexeddb://dsr50_1801/normal/model.json",
    "version": "6fe700e7ecb30e0d",
    "hasDestroy": true
  }
}
```

standby 页面读取后会调用：

```ts
GFLIndexedDBLive2D.resolveLive2DState(adjutant.live2d)
```

并得到：

```ts
{
  dir: "dsr50_1801",
  jsonPath: "blob:...",
  damagedJsonPath: "blob:...",
  source: "indexeddb"
}
```

然后传给 Pixi Live2D runtime 渲染。

---

## 18. 禁止行为

写入端不应该：

1. 不应该写 CDN URL；
2. 不应该写 `file://` 绝对路径；
3. 不应该资源路径改成绝对路径；
4. 不应该把二进制资源塞进 `model.json`；
5. 不应该先写 meta 再写资源；
6. 不应该静默接受半残 destroy 状态；
7. 不应该忽略 `gfl_touch_motions` 和 `motions` 的对应关系；
8. 不应该重新引入静态立绘 fallback。

---

## 19. 必须满足的最终条件

写入端成功后，IndexedDB 中必须至少存在：

```text
<dir>/normal/model.json
<dir>/normal/<model.json.model>
<dir>/normal/<textures[0]>
```

如果要完整交互，还必须存在：

```text
<dir>/normal/<motions 中所有 motion.file>
<dir>/normal/<gfl_touch_motions 中所有路径>
```

返回值必须至少包含：

```json
{
  "ok": true,
  "adjutant": {
    "live2d": {
      "dir": "<dir>",
      "jsonPath": "indexeddb://<dir>/normal/model.json",
      "version": "<version>",
      "hasDestroy": true
    }
  },
  "manifest": {
    "dir": "<dir>",
    "version": "<version>",
    "databaseName": "gfl-live2d-assets",
    "storeName": "assets",
    "assets": []
  }
}
```
