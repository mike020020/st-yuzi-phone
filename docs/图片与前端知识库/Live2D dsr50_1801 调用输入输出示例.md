# Live2D `dsr50_1801` 调用输入输出示例

本文档用真实模型目录作为例子，说明 Live2D IndexedDB 存储插件的完整调用输入和输出。

示例模型目录：

```text
/Users/liuzhenhua/PycharmProjects/酒馆ui/Girls-Frontline/dsr50_1801
```

模型文件夹名，也就是接口使用的 `dir`：

```text
dsr50_1801
```

该模型包含两个状态：

| 状态 | 目录 | 说明 |
|---|---|---|
| `normal` | `dsr50_1801/normal` | 普通状态 |
| `destroy` | `dsr50_1801/destroy` | 大破状态 |

插件只负责把模型资源写入 IndexedDB。运行时页面不应直接假定气泡插件暴露
`window.BubbleLive2D.getModelPackage()`；气泡图片、头像和 Live2D 属于同一插件生态，
但不同页面最终应通过项目内 IndexedDB loader 解析为可供渲染器使用的 Blob URL。

少女前线待机页当前读取模型内容的主接口是：

```js
window.GFLIndexedDBLive2D.resolveLive2DState({ dir: 'dsr50_1801' })
```

`window.BubbleLive2D.getModelPackage('dsr50_1801')` 只代表旧版/中间层 package API，
不得作为酒馆正则 iframe 中的稳定调用入口写入前端。

---

## 1. IndexedDB 写入目标

写入后，资源 key 使用以下格式：

```text
<dir>/<state>/<relativePath>
```

本例中会写入类似下面的 key：

```text
dsr50_1801/normal/model.json
dsr50_1801/normal/model.moc
dsr50_1801/normal/model.1024/texture_00.png
dsr50_1801/normal/physics.json
dsr50_1801/normal/motions/daiji_idle_01.mtn
dsr50_1801/destroy/model.json
dsr50_1801/destroy/model.moc
dsr50_1801/destroy/model.1024/texture_00.png
dsr50_1801/destroy/physics.json
dsr50_1801/destroy/pose.json
dsr50_1801/destroy/motions/broken_1.mtn
meta/dsr50_1801/version
```

---

## 2. 本例真实资源清单

### 2.1 `normal` 状态资源

| 相对路径 | 大小 byte |
|---|---:|
| `model.json` | 1931 |
| `model.moc` | 449940 |
| `model.1024/texture_00.png` | 1374678 |
| `physics.json` | 7842 |
| `motions/daiji_idle_01.mtn` | 19065 |
| `motions/login.mtn` | 15585 |
| `motions/newyear.mtn` | 19688 |
| `motions/shake.mtn` | 6995 |
| `motions/touch_1.mtn` | 23878 |
| `motions/touch_2.mtn` | 29476 |
| `motions/touch_3.mtn` | 31127 |
| `motions/touch_4.mtn` | 18708 |
| `motions/touch_5.mtn` | 16013 |
| `motions/touch_6.mtn` | 33357 |
| `motions/wait_1.mtn` | 39991 |
| `motions/wait_2.mtn` | 43954 |
| `motions/wedding.mtn` | 59852 |
| `motions/wedding_touch.mtn` | 26111 |

### 2.2 `destroy` 状态资源

| 相对路径 | 大小 byte |
|---|---:|
| `model.json` | 1425 |
| `model.moc` | 345735 |
| `model.1024/texture_00.png` | 1226813 |
| `physics.json` | 8277 |
| `pose.json` | 177 |
| `motions/broken_1.mtn` | 21611 |
| `motions/broken_2.mtn` | 16888 |
| `motions/broken_3.mtn` | 25223 |
| `motions/broken_4.mtn` | 26423 |
| `motions/broken_5.mtn` | 18198 |
| `motions/daiji_idle_01.mtn` | 23056 |
| `motions/login.mtn` | 11542 |
| `motions/shake.mtn` | 6938 |

---

## 3. 写入调用输入

写入接口：

```ts
async function writeLive2DPackage(input: Live2DWriteInput): Promise<Live2DWriteResult>;
```

对 `dsr50_1801` 的调用输入如下。

二进制文件在调用时应传入 `File`、`Blob`、`ArrayBuffer` 或 `Uint8Array`。下面示例中的变量名表示从真实文件读取出来的文件对象。

```js
const result = await writeLive2DPackage({
  dir: 'dsr50_1801',
  name: 'DSR-50',
  states: {
    normal: {
      files: {
        'model.json': normalModelJsonFile,
        'model.moc': normalModelMocFile,
        'model.1024/texture_00.png': normalTextureFile,
        'physics.json': normalPhysicsFile,
        'motions/daiji_idle_01.mtn': normalIdleMotionFile,
        'motions/login.mtn': normalLoginMotionFile,
        'motions/newyear.mtn': normalNewyearMotionFile,
        'motions/shake.mtn': normalShakeMotionFile,
        'motions/touch_1.mtn': normalTouch1MotionFile,
        'motions/touch_2.mtn': normalTouch2MotionFile,
        'motions/touch_3.mtn': normalTouch3MotionFile,
        'motions/touch_4.mtn': normalTouch4MotionFile,
        'motions/touch_5.mtn': normalTouch5MotionFile,
        'motions/touch_6.mtn': normalTouch6MotionFile,
        'motions/wait_1.mtn': normalWait1MotionFile,
        'motions/wait_2.mtn': normalWait2MotionFile,
        'motions/wedding.mtn': normalWeddingMotionFile,
        'motions/wedding_touch.mtn': normalWeddingTouchMotionFile
      }
    },
    destroy: {
      files: {
        'model.json': destroyModelJsonFile,
        'model.moc': destroyModelMocFile,
        'model.1024/texture_00.png': destroyTextureFile,
        'physics.json': destroyPhysicsFile,
        'pose.json': destroyPoseFile,
        'motions/broken_1.mtn': destroyBroken1MotionFile,
        'motions/broken_2.mtn': destroyBroken2MotionFile,
        'motions/broken_3.mtn': destroyBroken3MotionFile,
        'motions/broken_4.mtn': destroyBroken4MotionFile,
        'motions/broken_5.mtn': destroyBroken5MotionFile,
        'motions/daiji_idle_01.mtn': destroyIdleMotionFile,
        'motions/login.mtn': destroyLoginMotionFile,
        'motions/shake.mtn': destroyShakeMotionFile
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

## 4. `normal/model.json` 实际内容

```json
{
  "version": "Sample 1.0.0",
  "model": "model.moc",
  "textures": [
    "model.1024/texture_00.png"
  ],
  "motions": {
    "idle": [
      {
        "file": "motions/daiji_idle_01.mtn"
      }
    ],
    "": [
      {
        "file": "motions/login.mtn"
      },
      {
        "file": "motions/shake.mtn"
      },
      {
        "file": "motions/touch_1.mtn"
      },
      {
        "file": "motions/touch_2.mtn"
      },
      {
        "file": "motions/touch_3.mtn"
      },
      {
        "file": "motions/touch_4.mtn"
      },
      {
        "file": "motions/touch_5.mtn"
      },
      {
        "file": "motions/touch_6.mtn"
      },
      {
        "file": "motions/wait_1.mtn"
      },
      {
        "file": "motions/wait_2.mtn"
      },
      {
        "file": "motions/wedding.mtn"
      },
      {
        "file": "motions/newyear.mtn"
      },
      {
        "file": "motions/wedding_touch.mtn"
      }
    ]
  },
  "physics": "physics.json",
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
  "gfl_touch_motions": {
    "face": [
      "motions/touch_1.mtn",
      "motions/touch_2.mtn",
      "motions/touch_3.mtn",
      "motions/touch_4.mtn",
      "motions/touch_5.mtn",
      "motions/touch_6.mtn",
      "motions/wedding_touch.mtn"
    ],
    "body": [
      "motions/touch_1.mtn",
      "motions/touch_2.mtn",
      "motions/touch_3.mtn",
      "motions/touch_4.mtn",
      "motions/touch_5.mtn",
      "motions/touch_6.mtn",
      "motions/wedding_touch.mtn"
    ],
    "leg": [
      "motions/touch_1.mtn",
      "motions/touch_2.mtn",
      "motions/touch_3.mtn",
      "motions/touch_4.mtn",
      "motions/touch_5.mtn",
      "motions/touch_6.mtn",
      "motions/wedding_touch.mtn"
    ],
    "shake": [
      "motions/shake.mtn"
    ]
  }
}
```

---

## 5. `destroy/model.json` 实际内容

```json
{
  "version": "Sample 1.0.0",
  "model": "model.moc",
  "textures": [
    "model.1024/texture_00.png"
  ],
  "motions": {
    "": [
      {
        "file": "motions/broken_1.mtn"
      },
      {
        "file": "motions/broken_2.mtn"
      },
      {
        "file": "motions/broken_3.mtn"
      },
      {
        "file": "motions/broken_4.mtn"
      },
      {
        "file": "motions/broken_5.mtn"
      },
      {
        "file": "motions/login.mtn"
      },
      {
        "file": "motions/shake.mtn"
      }
    ],
    "idle": [
      {
        "file": "motions/daiji_idle_01.mtn"
      }
    ]
  },
  "physics": "physics.json",
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
  "gfl_touch_motions": {
    "face": [
      "motions/broken_1.mtn",
      "motions/broken_2.mtn",
      "motions/broken_3.mtn",
      "motions/broken_4.mtn",
      "motions/broken_5.mtn"
    ],
    "body": [
      "motions/broken_1.mtn",
      "motions/broken_2.mtn",
      "motions/broken_3.mtn",
      "motions/broken_4.mtn",
      "motions/broken_5.mtn"
    ],
    "leg": [
      "motions/broken_1.mtn",
      "motions/broken_2.mtn",
      "motions/broken_3.mtn",
      "motions/broken_4.mtn",
      "motions/broken_5.mtn"
    ],
    "shake": [
      "motions/shake.mtn"
    ]
  }
}
```

---

## 6. 写入成功输出示例

`version` 由写入端根据内容生成，下面使用 `content-version` 表示一次实际写入得到的版本字符串。

```js
{
  ok: true,
  dir: 'dsr50_1801',
  version: 'content-version',
  adjutant: {
    name: 'DSR-50',
    live2d: {
      dir: 'dsr50_1801',
      jsonPath: 'indexeddb://dsr50_1801/normal/model.json',
      version: 'content-version',
      hasDestroy: true
    }
  },
  manifest: {
    dir: 'dsr50_1801',
    name: 'DSR-50',
    version: 'content-version',
    databaseName: 'gfl-live2d-assets',
    storeName: 'assets',
    states: {
      normal: {
        state: 'normal',
        files: 18,
        assets: [
          {
            key: 'dsr50_1801/normal/model.json',
            relativePath: 'model.json',
            kind: 'model-json',
            mime: 'application/json',
            size: 1931
          },
          {
            key: 'dsr50_1801/normal/model.moc',
            relativePath: 'model.moc',
            kind: 'moc',
            mime: 'application/octet-stream',
            size: 449940
          },
          {
            key: 'dsr50_1801/normal/model.1024/texture_00.png',
            relativePath: 'model.1024/texture_00.png',
            kind: 'texture',
            mime: 'image/png',
            size: 1374678
          },
          {
            key: 'dsr50_1801/normal/physics.json',
            relativePath: 'physics.json',
            kind: 'physics',
            mime: 'application/json',
            size: 7842
          },
          {
            key: 'dsr50_1801/normal/motions/daiji_idle_01.mtn',
            relativePath: 'motions/daiji_idle_01.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 19065
          },
          {
            key: 'dsr50_1801/normal/motions/login.mtn',
            relativePath: 'motions/login.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 15585
          },
          {
            key: 'dsr50_1801/normal/motions/newyear.mtn',
            relativePath: 'motions/newyear.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 19688
          },
          {
            key: 'dsr50_1801/normal/motions/shake.mtn',
            relativePath: 'motions/shake.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 6995
          },
          {
            key: 'dsr50_1801/normal/motions/touch_1.mtn',
            relativePath: 'motions/touch_1.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 23878
          },
          {
            key: 'dsr50_1801/normal/motions/touch_2.mtn',
            relativePath: 'motions/touch_2.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 29476
          },
          {
            key: 'dsr50_1801/normal/motions/touch_3.mtn',
            relativePath: 'motions/touch_3.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 31127
          },
          {
            key: 'dsr50_1801/normal/motions/touch_4.mtn',
            relativePath: 'motions/touch_4.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 18708
          },
          {
            key: 'dsr50_1801/normal/motions/touch_5.mtn',
            relativePath: 'motions/touch_5.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 16013
          },
          {
            key: 'dsr50_1801/normal/motions/touch_6.mtn',
            relativePath: 'motions/touch_6.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 33357
          },
          {
            key: 'dsr50_1801/normal/motions/wait_1.mtn',
            relativePath: 'motions/wait_1.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 39991
          },
          {
            key: 'dsr50_1801/normal/motions/wait_2.mtn',
            relativePath: 'motions/wait_2.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 43954
          },
          {
            key: 'dsr50_1801/normal/motions/wedding.mtn',
            relativePath: 'motions/wedding.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 59852
          },
          {
            key: 'dsr50_1801/normal/motions/wedding_touch.mtn',
            relativePath: 'motions/wedding_touch.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 26111
          }
        ]
      },
      destroy: {
        state: 'destroy',
        files: 13,
        assets: [
          {
            key: 'dsr50_1801/destroy/model.json',
            relativePath: 'model.json',
            kind: 'model-json',
            mime: 'application/json',
            size: 1425
          },
          {
            key: 'dsr50_1801/destroy/model.moc',
            relativePath: 'model.moc',
            kind: 'moc',
            mime: 'application/octet-stream',
            size: 345735
          },
          {
            key: 'dsr50_1801/destroy/model.1024/texture_00.png',
            relativePath: 'model.1024/texture_00.png',
            kind: 'texture',
            mime: 'image/png',
            size: 1226813
          },
          {
            key: 'dsr50_1801/destroy/physics.json',
            relativePath: 'physics.json',
            kind: 'physics',
            mime: 'application/json',
            size: 8277
          },
          {
            key: 'dsr50_1801/destroy/pose.json',
            relativePath: 'pose.json',
            kind: 'pose',
            mime: 'application/json',
            size: 177
          },
          {
            key: 'dsr50_1801/destroy/motions/broken_1.mtn',
            relativePath: 'motions/broken_1.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 21611
          },
          {
            key: 'dsr50_1801/destroy/motions/broken_2.mtn',
            relativePath: 'motions/broken_2.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 16888
          },
          {
            key: 'dsr50_1801/destroy/motions/broken_3.mtn',
            relativePath: 'motions/broken_3.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 25223
          },
          {
            key: 'dsr50_1801/destroy/motions/broken_4.mtn',
            relativePath: 'motions/broken_4.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 26423
          },
          {
            key: 'dsr50_1801/destroy/motions/broken_5.mtn',
            relativePath: 'motions/broken_5.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 18198
          },
          {
            key: 'dsr50_1801/destroy/motions/daiji_idle_01.mtn',
            relativePath: 'motions/daiji_idle_01.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 23056
          },
          {
            key: 'dsr50_1801/destroy/motions/login.mtn',
            relativePath: 'motions/login.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 11542
          },
          {
            key: 'dsr50_1801/destroy/motions/shake.mtn',
            relativePath: 'motions/shake.mtn',
            kind: 'motion',
            mime: 'application/octet-stream',
            size: 6938
          }
        ]
      }
    },
    assets: [
      {
        key: 'dsr50_1801/normal/model.json',
        state: 'normal',
        relativePath: 'model.json',
        kind: 'model-json',
        mime: 'application/json',
        size: 1931
      },
      {
        key: 'dsr50_1801/normal/model.moc',
        state: 'normal',
        relativePath: 'model.moc',
        kind: 'moc',
        mime: 'application/octet-stream',
        size: 449940
      },
      {
        key: 'dsr50_1801/normal/model.1024/texture_00.png',
        state: 'normal',
        relativePath: 'model.1024/texture_00.png',
        kind: 'texture',
        mime: 'image/png',
        size: 1374678
      },
      {
        key: 'dsr50_1801/normal/physics.json',
        state: 'normal',
        relativePath: 'physics.json',
        kind: 'physics',
        mime: 'application/json',
        size: 7842
      },
      {
        key: 'dsr50_1801/normal/motions/daiji_idle_01.mtn',
        state: 'normal',
        relativePath: 'motions/daiji_idle_01.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 19065
      },
      {
        key: 'dsr50_1801/normal/motions/login.mtn',
        state: 'normal',
        relativePath: 'motions/login.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 15585
      },
      {
        key: 'dsr50_1801/normal/motions/newyear.mtn',
        state: 'normal',
        relativePath: 'motions/newyear.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 19688
      },
      {
        key: 'dsr50_1801/normal/motions/shake.mtn',
        state: 'normal',
        relativePath: 'motions/shake.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 6995
      },
      {
        key: 'dsr50_1801/normal/motions/touch_1.mtn',
        state: 'normal',
        relativePath: 'motions/touch_1.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 23878
      },
      {
        key: 'dsr50_1801/normal/motions/touch_2.mtn',
        state: 'normal',
        relativePath: 'motions/touch_2.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 29476
      },
      {
        key: 'dsr50_1801/normal/motions/touch_3.mtn',
        state: 'normal',
        relativePath: 'motions/touch_3.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 31127
      },
      {
        key: 'dsr50_1801/normal/motions/touch_4.mtn',
        state: 'normal',
        relativePath: 'motions/touch_4.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 18708
      },
      {
        key: 'dsr50_1801/normal/motions/touch_5.mtn',
        state: 'normal',
        relativePath: 'motions/touch_5.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 16013
      },
      {
        key: 'dsr50_1801/normal/motions/touch_6.mtn',
        state: 'normal',
        relativePath: 'motions/touch_6.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 33357
      },
      {
        key: 'dsr50_1801/normal/motions/wait_1.mtn',
        state: 'normal',
        relativePath: 'motions/wait_1.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 39991
      },
      {
        key: 'dsr50_1801/normal/motions/wait_2.mtn',
        state: 'normal',
        relativePath: 'motions/wait_2.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 43954
      },
      {
        key: 'dsr50_1801/normal/motions/wedding.mtn',
        state: 'normal',
        relativePath: 'motions/wedding.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 59852
      },
      {
        key: 'dsr50_1801/normal/motions/wedding_touch.mtn',
        state: 'normal',
        relativePath: 'motions/wedding_touch.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 26111
      },
      {
        key: 'dsr50_1801/destroy/model.json',
        state: 'destroy',
        relativePath: 'model.json',
        kind: 'model-json',
        mime: 'application/json',
        size: 1425
      },
      {
        key: 'dsr50_1801/destroy/model.moc',
        state: 'destroy',
        relativePath: 'model.moc',
        kind: 'moc',
        mime: 'application/octet-stream',
        size: 345735
      },
      {
        key: 'dsr50_1801/destroy/model.1024/texture_00.png',
        state: 'destroy',
        relativePath: 'model.1024/texture_00.png',
        kind: 'texture',
        mime: 'image/png',
        size: 1226813
      },
      {
        key: 'dsr50_1801/destroy/physics.json',
        state: 'destroy',
        relativePath: 'physics.json',
        kind: 'physics',
        mime: 'application/json',
        size: 8277
      },
      {
        key: 'dsr50_1801/destroy/pose.json',
        state: 'destroy',
        relativePath: 'pose.json',
        kind: 'pose',
        mime: 'application/json',
        size: 177
      },
      {
        key: 'dsr50_1801/destroy/motions/broken_1.mtn',
        state: 'destroy',
        relativePath: 'motions/broken_1.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 21611
      },
      {
        key: 'dsr50_1801/destroy/motions/broken_2.mtn',
        state: 'destroy',
        relativePath: 'motions/broken_2.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 16888
      },
      {
        key: 'dsr50_1801/destroy/motions/broken_3.mtn',
        state: 'destroy',
        relativePath: 'motions/broken_3.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 25223
      },
      {
        key: 'dsr50_1801/destroy/motions/broken_4.mtn',
        state: 'destroy',
        relativePath: 'motions/broken_4.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 26423
      },
      {
        key: 'dsr50_1801/destroy/motions/broken_5.mtn',
        state: 'destroy',
        relativePath: 'motions/broken_5.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 18198
      },
      {
        key: 'dsr50_1801/destroy/motions/daiji_idle_01.mtn',
        state: 'destroy',
        relativePath: 'motions/daiji_idle_01.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 23056
      },
      {
        key: 'dsr50_1801/destroy/motions/login.mtn',
        state: 'destroy',
        relativePath: 'motions/login.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 11542
      },
      {
        key: 'dsr50_1801/destroy/motions/shake.mtn',
        state: 'destroy',
        relativePath: 'motions/shake.mtn',
        kind: 'motion',
        mime: 'application/octet-stream',
        size: 6938
      }
    ]
  }
}
```

---

## 7. 前端读取调用输入

前端不需要知道所有文件路径，也不需要自己拼 IndexedDB key。

读取时传入看板娘记录里的 `live2d` 状态对象：

```js
const resolvedState = await window.GFLIndexedDBLive2D.resolveLive2DState({
  dir: 'dsr50_1801',
  jsonPath: 'indexeddb://dsr50_1801/normal/model.json'
});
```

---

## 8. 前端读取输出结构

读取成功后返回可直接交给 Pixi Live2D runtime 的状态对象。资源已经被解析成
`blob:` URL，不再要求业务页面自己遍历 package 或手写 `URL.createObjectURL()`。

```js
{
  dir: 'dsr50_1801',
  version: 'content-version',
  hasDestroy: true,
  jsonPath: 'indexeddb://dsr50_1801/normal/model.json',
  states: {
    normal: {
      state: 'normal',
      files: {
        'model.json': Blob,
        'model.moc': Blob,
        'model.1024/texture_00.png': Blob,
        'physics.json': Blob,
        'motions/daiji_idle_01.mtn': Blob,
        'motions/login.mtn': Blob,
        'motions/newyear.mtn': Blob,
        'motions/shake.mtn': Blob,
        'motions/touch_1.mtn': Blob,
        'motions/touch_2.mtn': Blob,
        'motions/touch_3.mtn': Blob,
        'motions/touch_4.mtn': Blob,
        'motions/touch_5.mtn': Blob,
        'motions/touch_6.mtn': Blob,
        'motions/wait_1.mtn': Blob,
        'motions/wait_2.mtn': Blob,
        'motions/wedding.mtn': Blob,
        'motions/wedding_touch.mtn': Blob
      },
      modelJson: {
        version: 'Sample 1.0.0',
        model: 'model.moc',
        textures: [
          'model.1024/texture_00.png'
        ],
        motions: {
          idle: [
            {
              file: 'motions/daiji_idle_01.mtn'
            }
          ],
          '': [
            {
              file: 'motions/login.mtn'
            },
            {
              file: 'motions/shake.mtn'
            },
            {
              file: 'motions/touch_1.mtn'
            },
            {
              file: 'motions/touch_2.mtn'
            },
            {
              file: 'motions/touch_3.mtn'
            },
            {
              file: 'motions/touch_4.mtn'
            },
            {
              file: 'motions/touch_5.mtn'
            },
            {
              file: 'motions/touch_6.mtn'
            },
            {
              file: 'motions/wait_1.mtn'
            },
            {
              file: 'motions/wait_2.mtn'
            },
            {
              file: 'motions/wedding.mtn'
            },
            {
              file: 'motions/newyear.mtn'
            },
            {
              file: 'motions/wedding_touch.mtn'
            }
          ]
        },
        physics: 'physics.json',
        hit_areas: [
          {
            name: 'face',
            id: 'D_REF.FACE'
          },
          {
            name: 'body',
            id: 'D_REF.BODY'
          },
          {
            name: 'leg',
            id: 'D_REF.LEG'
          }
        ],
        gfl_touch_motions: {
          face: [
            'motions/touch_1.mtn',
            'motions/touch_2.mtn',
            'motions/touch_3.mtn',
            'motions/touch_4.mtn',
            'motions/touch_5.mtn',
            'motions/touch_6.mtn',
            'motions/wedding_touch.mtn'
          ],
          body: [
            'motions/touch_1.mtn',
            'motions/touch_2.mtn',
            'motions/touch_3.mtn',
            'motions/touch_4.mtn',
            'motions/touch_5.mtn',
            'motions/touch_6.mtn',
            'motions/wedding_touch.mtn'
          ],
          leg: [
            'motions/touch_1.mtn',
            'motions/touch_2.mtn',
            'motions/touch_3.mtn',
            'motions/touch_4.mtn',
            'motions/touch_5.mtn',
            'motions/touch_6.mtn',
            'motions/wedding_touch.mtn'
          ],
          shake: [
            'motions/shake.mtn'
          ]
        }
      },
      assets: [
        {
          key: 'dsr50_1801/normal/model.json',
          state: 'normal',
          relativePath: 'model.json',
          kind: 'model-json',
          mime: 'application/json',
          size: 1931,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/model.moc',
          state: 'normal',
          relativePath: 'model.moc',
          kind: 'moc',
          mime: 'application/octet-stream',
          size: 449940,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/model.1024/texture_00.png',
          state: 'normal',
          relativePath: 'model.1024/texture_00.png',
          kind: 'texture',
          mime: 'image/png',
          size: 1374678,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/physics.json',
          state: 'normal',
          relativePath: 'physics.json',
          kind: 'physics',
          mime: 'application/json',
          size: 7842,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/daiji_idle_01.mtn',
          state: 'normal',
          relativePath: 'motions/daiji_idle_01.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 19065,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/login.mtn',
          state: 'normal',
          relativePath: 'motions/login.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 15585,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/newyear.mtn',
          state: 'normal',
          relativePath: 'motions/newyear.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 19688,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/shake.mtn',
          state: 'normal',
          relativePath: 'motions/shake.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 6995,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_1.mtn',
          state: 'normal',
          relativePath: 'motions/touch_1.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 23878,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_2.mtn',
          state: 'normal',
          relativePath: 'motions/touch_2.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 29476,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_3.mtn',
          state: 'normal',
          relativePath: 'motions/touch_3.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 31127,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_4.mtn',
          state: 'normal',
          relativePath: 'motions/touch_4.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 18708,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_5.mtn',
          state: 'normal',
          relativePath: 'motions/touch_5.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 16013,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/touch_6.mtn',
          state: 'normal',
          relativePath: 'motions/touch_6.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 33357,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/wait_1.mtn',
          state: 'normal',
          relativePath: 'motions/wait_1.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 39991,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/wait_2.mtn',
          state: 'normal',
          relativePath: 'motions/wait_2.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 43954,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/wedding.mtn',
          state: 'normal',
          relativePath: 'motions/wedding.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 59852,
          blob: Blob
        },
        {
          key: 'dsr50_1801/normal/motions/wedding_touch.mtn',
          state: 'normal',
          relativePath: 'motions/wedding_touch.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 26111,
          blob: Blob
        }
      ]
    },
    destroy: {
      state: 'destroy',
      files: {
        'model.json': Blob,
        'model.moc': Blob,
        'model.1024/texture_00.png': Blob,
        'physics.json': Blob,
        'pose.json': Blob,
        'motions/broken_1.mtn': Blob,
        'motions/broken_2.mtn': Blob,
        'motions/broken_3.mtn': Blob,
        'motions/broken_4.mtn': Blob,
        'motions/broken_5.mtn': Blob,
        'motions/daiji_idle_01.mtn': Blob,
        'motions/login.mtn': Blob,
        'motions/shake.mtn': Blob
      },
      modelJson: {
        version: 'Sample 1.0.0',
        model: 'model.moc',
        textures: [
          'model.1024/texture_00.png'
        ],
        motions: {
          '': [
            {
              file: 'motions/broken_1.mtn'
            },
            {
              file: 'motions/broken_2.mtn'
            },
            {
              file: 'motions/broken_3.mtn'
            },
            {
              file: 'motions/broken_4.mtn'
            },
            {
              file: 'motions/broken_5.mtn'
            },
            {
              file: 'motions/login.mtn'
            },
            {
              file: 'motions/shake.mtn'
            }
          ],
          idle: [
            {
              file: 'motions/daiji_idle_01.mtn'
            }
          ]
        },
        physics: 'physics.json',
        hit_areas: [
          {
            name: 'face',
            id: 'D_REF.FACE'
          },
          {
            name: 'body',
            id: 'D_REF.BODY'
          },
          {
            name: 'leg',
            id: 'D_REF.LEG'
          }
        ],
        gfl_touch_motions: {
          face: [
            'motions/broken_1.mtn',
            'motions/broken_2.mtn',
            'motions/broken_3.mtn',
            'motions/broken_4.mtn',
            'motions/broken_5.mtn'
          ],
          body: [
            'motions/broken_1.mtn',
            'motions/broken_2.mtn',
            'motions/broken_3.mtn',
            'motions/broken_4.mtn',
            'motions/broken_5.mtn'
          ],
          leg: [
            'motions/broken_1.mtn',
            'motions/broken_2.mtn',
            'motions/broken_3.mtn',
            'motions/broken_4.mtn',
            'motions/broken_5.mtn'
          ],
          shake: [
            'motions/shake.mtn'
          ]
        }
      },
      assets: [
        {
          key: 'dsr50_1801/destroy/model.json',
          state: 'destroy',
          relativePath: 'model.json',
          kind: 'model-json',
          mime: 'application/json',
          size: 1425,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/model.moc',
          state: 'destroy',
          relativePath: 'model.moc',
          kind: 'moc',
          mime: 'application/octet-stream',
          size: 345735,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/model.1024/texture_00.png',
          state: 'destroy',
          relativePath: 'model.1024/texture_00.png',
          kind: 'texture',
          mime: 'image/png',
          size: 1226813,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/physics.json',
          state: 'destroy',
          relativePath: 'physics.json',
          kind: 'physics',
          mime: 'application/json',
          size: 8277,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/pose.json',
          state: 'destroy',
          relativePath: 'pose.json',
          kind: 'pose',
          mime: 'application/json',
          size: 177,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/broken_1.mtn',
          state: 'destroy',
          relativePath: 'motions/broken_1.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 21611,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/broken_2.mtn',
          state: 'destroy',
          relativePath: 'motions/broken_2.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 16888,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/broken_3.mtn',
          state: 'destroy',
          relativePath: 'motions/broken_3.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 25223,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/broken_4.mtn',
          state: 'destroy',
          relativePath: 'motions/broken_4.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 26423,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/broken_5.mtn',
          state: 'destroy',
          relativePath: 'motions/broken_5.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 18198,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/daiji_idle_01.mtn',
          state: 'destroy',
          relativePath: 'motions/daiji_idle_01.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 23056,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/login.mtn',
          state: 'destroy',
          relativePath: 'motions/login.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 11542,
          blob: Blob
        },
        {
          key: 'dsr50_1801/destroy/motions/shake.mtn',
          state: 'destroy',
          relativePath: 'motions/shake.mtn',
          kind: 'motion',
          mime: 'application/octet-stream',
          size: 6938,
          blob: Blob
        }
      ]
    }
  },
  assets: [
    {
      key: 'dsr50_1801/normal/model.json',
      state: 'normal',
      relativePath: 'model.json',
      kind: 'model-json',
      mime: 'application/json',
      size: 1931,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/model.moc',
      state: 'normal',
      relativePath: 'model.moc',
      kind: 'moc',
      mime: 'application/octet-stream',
      size: 449940,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/model.1024/texture_00.png',
      state: 'normal',
      relativePath: 'model.1024/texture_00.png',
      kind: 'texture',
      mime: 'image/png',
      size: 1374678,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/physics.json',
      state: 'normal',
      relativePath: 'physics.json',
      kind: 'physics',
      mime: 'application/json',
      size: 7842,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/daiji_idle_01.mtn',
      state: 'normal',
      relativePath: 'motions/daiji_idle_01.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 19065,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/login.mtn',
      state: 'normal',
      relativePath: 'motions/login.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 15585,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/newyear.mtn',
      state: 'normal',
      relativePath: 'motions/newyear.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 19688,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/shake.mtn',
      state: 'normal',
      relativePath: 'motions/shake.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 6995,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_1.mtn',
      state: 'normal',
      relativePath: 'motions/touch_1.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 23878,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_2.mtn',
      state: 'normal',
      relativePath: 'motions/touch_2.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 29476,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_3.mtn',
      state: 'normal',
      relativePath: 'motions/touch_3.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 31127,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_4.mtn',
      state: 'normal',
      relativePath: 'motions/touch_4.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 18708,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_5.mtn',
      state: 'normal',
      relativePath: 'motions/touch_5.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 16013,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/touch_6.mtn',
      state: 'normal',
      relativePath: 'motions/touch_6.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 33357,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/wait_1.mtn',
      state: 'normal',
      relativePath: 'motions/wait_1.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 39991,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/wait_2.mtn',
      state: 'normal',
      relativePath: 'motions/wait_2.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 43954,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/wedding.mtn',
      state: 'normal',
      relativePath: 'motions/wedding.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 59852,
      blob: Blob
    },
    {
      key: 'dsr50_1801/normal/motions/wedding_touch.mtn',
      state: 'normal',
      relativePath: 'motions/wedding_touch.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 26111,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/model.json',
      state: 'destroy',
      relativePath: 'model.json',
      kind: 'model-json',
      mime: 'application/json',
      size: 1425,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/model.moc',
      state: 'destroy',
      relativePath: 'model.moc',
      kind: 'moc',
      mime: 'application/octet-stream',
      size: 345735,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/model.1024/texture_00.png',
      state: 'destroy',
      relativePath: 'model.1024/texture_00.png',
      kind: 'texture',
      mime: 'image/png',
      size: 1226813,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/physics.json',
      state: 'destroy',
      relativePath: 'physics.json',
      kind: 'physics',
      mime: 'application/json',
      size: 8277,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/pose.json',
      state: 'destroy',
      relativePath: 'pose.json',
      kind: 'pose',
      mime: 'application/json',
      size: 177,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/broken_1.mtn',
      state: 'destroy',
      relativePath: 'motions/broken_1.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 21611,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/broken_2.mtn',
      state: 'destroy',
      relativePath: 'motions/broken_2.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 16888,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/broken_3.mtn',
      state: 'destroy',
      relativePath: 'motions/broken_3.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 25223,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/broken_4.mtn',
      state: 'destroy',
      relativePath: 'motions/broken_4.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 26423,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/broken_5.mtn',
      state: 'destroy',
      relativePath: 'motions/broken_5.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 18198,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/daiji_idle_01.mtn',
      state: 'destroy',
      relativePath: 'motions/daiji_idle_01.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 23056,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/login.mtn',
      state: 'destroy',
      relativePath: 'motions/login.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 11542,
      blob: Blob
    },
    {
      key: 'dsr50_1801/destroy/motions/shake.mtn',
      state: 'destroy',
      relativePath: 'motions/shake.mtn',
      kind: 'motion',
      mime: 'application/octet-stream',
      size: 6938,
      blob: Blob
    }
  ]
}
```

---

## 9. 前端取资源示例

### 9.1 取普通状态资源

```js
const resolvedState = await window.GFLIndexedDBLive2D.resolveLive2DState({ dir: 'dsr50_1801' });
await window.GFLPixiLive2D.mount({
  container: document.querySelector('.gfl-character'),
  jsonPath: resolvedState.jsonPath,
  width: 360,
  height: 640
});
```

在本例中：

```js
modelJson.model === 'model.moc';
modelJson.textures[0] === 'model.1024/texture_00.png';
modelJson.physics === 'physics.json';
```

所以等价于：

```js
const modelJsonBlob = normal.files['model.json'];
const mocBlob = normal.files['model.moc'];
const textureBlob = normal.files['model.1024/texture_00.png'];
const physicsBlob = normal.files['physics.json'];
```

### 9.2 取大破状态资源

```js
const resolvedState = await window.GFLIndexedDBLive2D.resolveLive2DState({ dir: 'dsr50_1801' });
const destroyJsonPath = resolvedState.damagedJsonPath;
```

---

## 10. 如果 Live2D runtime 需要 URL

有些 Live2D runtime 不直接接收 `Blob`，而是接收 URL。当前项目的
`GFLIndexedDBLive2D.resolveLive2DState()` 已经完成这一步，业务页面只使用返回的
`jsonPath` / `damagedJsonPath`。

```js
const resolvedState = await window.GFLIndexedDBLive2D.resolveLive2DState({ dir: 'dsr50_1801' });
loadLive2D(resolvedState.jsonPath, 'DSR-50');
```

用完后释放 URL：

```js
window.GFLIndexedDBLive2D.revokeObjectUrls();
```

---

## 11. 最小完整链路

```text
/Users/liuzhenhua/PycharmProjects/酒馆ui/Girls-Frontline/dsr50_1801
-> writeLive2DPackage({ dir: 'dsr50_1801', states: { normal, destroy } })
-> IndexedDB 写入 31 个模型资源和 meta/dsr50_1801/version
-> window.GFLIndexedDBLive2D.resolveLive2DState({ dir: 'dsr50_1801' })
-> 前端拿到 jsonPath / damagedJsonPath 两个 blob: URL
-> 交给 GFLPixiLive2D.mount 渲染
```

本例里，`adjutant.live2d` 是待机页读取模型内容的输入状态对象，至少应包含 `dir`。

前端读取模型内容的主入口固定为：

```js
window.GFLIndexedDBLive2D.resolveLive2DState(adjutant.live2d)
```
