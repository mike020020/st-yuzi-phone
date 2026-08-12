/**
 * 对话渲染系统 v7.0 — 对话气泡管理脚本
 * 包含：头像管理（含角色主题色 + 情绪差分头像 + 角色卡隔离 + 网络图床 + CG 图片库）+ 正文美化设置 + 情绪配置 + 格式规则注入
 * 对话渲染由正则模板内的 JS 完成，本脚本负责管理面板 UI、配置写入和 prompt 动态注入
 * v6.0: 取消别名机制，改用角色全名作为唯一标识；世界书彻底清空，格式规则+情绪词由脚本动态注入
 * v7.0: 网络图床（头像 sourceUrl 懒加载）+ CG 图片库（按组管理 + 公开 API）+ 旁白三滑块 + 魔法棒修复 + 全局头像 + 图片压缩
 * 依赖：酒馆助手（JS-Slash-Runner）
 */

// ████████████████████████████████████████████████████████████
// █                                                        █
// █  Part 1: IndexedDB 存储层                               █
// █                                                        █
// ████████████████████████████████████████████████████████████

const DB_NAME = 'BubbleDialogueAvatars';
const DB_VERSION = 4;
const STORE_AVATARS = 'avatars';
const STORE_CONFIG = 'config';
const STORE_MOOD_AVATARS = 'mood_avatars';
const STORE_LOCAL_FONTS = 'local_fonts';
const STORE_CG_GROUPS = 'cg_groups';
const STORE_CG_IMAGES = 'cg_images';
const LIVE2D_DB_NAME = 'gfl-live2d-assets';
const LIVE2D_STORE_NAME = 'assets';
const LIVE2D_META_PREFIX = 'meta';
const CHAR_ID_SEPARATOR = '__';
const GLOBAL_CHAR_ID = '_global_';
const CG_FETCH_TIMEOUT = 15000;
const IMAGE_EXTS_RE = /\.(webp|png|jpg|jpeg|gif|bmp|avif)$/i;
const LOCAL_FONT_MAX_SIZE = 8 * 1024 * 1024;
const LOCAL_FONT_ACCEPT = '.woff2,.woff,.ttf,.otf';
const FONT_EXT_FORMAT_MAP = {
  woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype'
};
const FONT_EXT_MIME_MAP = {
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/opentype'
};

const MOOD_GROUPS = [
  { id: 'mood-joy',     label: '喜悦', color: '#f59e0b' },
  { id: 'mood-anger',   label: '愤怒', color: '#ef4444' },
  { id: 'mood-sad',     label: '悲伤', color: '#3b82f6' },
  { id: 'mood-anxious', label: '紧张', color: '#eab308' },
  { id: 'mood-calm',    label: '平和', color: '#22c55e' },
  { id: 'mood-shy',     label: '害羞', color: '#06b6d4' },
  { id: 'mood-disgust', label: '嫌弃', color: '#8b5cf6' },
  { id: 'mood-love',    label: '爱恋', color: '#ec4899' },
];

// ===== v6.0 默认情绪词配置（8 组 108 词） =====
const DEFAULT_MOOD_GROUPS = Object.freeze([
  { id: 'mood-joy',     label: '喜悦', color: '#f59e0b', words: ['开心','欢喜','欣喜','愉悦','满足','幸福','甜蜜','狂喜','兴奋','雀跃','畅快','陶醉','得意','骄傲','自豪','自信'] },
  { id: 'mood-anger',   label: '愤怒', color: '#ef4444', words: ['愤怒','暴怒','气愤','愤慨','暴躁','怨恨','敌意','恼火','窝火','生气','烦躁','烦闷'] },
  { id: 'mood-sad',     label: '悲伤', color: '#3b82f6', words: ['难过','伤心','心酸','忧伤','惆怅','失落','低落','沮丧','悲伤','心痛','悲痛','痛苦','委屈','不甘','失望','受伤','孤独','寂寞','落寞'] },
  { id: 'mood-anxious', label: '紧张', color: '#eab308', words: ['焦虑','紧张','不安','忐忑','担忧','慌张','焦躁','害怕','恐惧','惊恐','畏惧','胆怯','心慌','警惕','戒备'] },
  { id: 'mood-calm',    label: '平和', color: '#22c55e', words: ['平静','淡然','冷静','沉稳','从容','坦然','淡定','温馨','舒畅','惬意','温暖','欣慰','释然','感动','感恩'] },
  { id: 'mood-shy',     label: '害羞', color: '#06b6d4', words: ['害羞','尴尬','窘迫','难堪','困惑','迷茫','疑惑','纠结','犹豫','无奈','无语'] },
  { id: 'mood-disgust', label: '嫌弃', color: '#8b5cf6', words: ['厌恶','嫌弃','鄙视','反感','排斥','抗拒','不屑','冷淡','冷漠','疏离','麻木'] },
  { id: 'mood-love',    label: '爱恋', color: '#ec4899', words: ['喜欢','爱慕','迷恋','倾慕','宠溺','依恋','心动','认真'] },
]);

// ===== v7.0 默认格式规则（三段式） =====
const DEFAULT_FORMAT_RULE = `[对话渲染格式规范]
当角色产生想法、进行对白、突然的反应或者有莫名的声音、奇怪的低语出现时必须严格使用以下格式（全部在同一行内）：

@bubble:角色名|情绪|[对白]

格式规则：
1. @bubble: 是固定前缀，不可更改
2. 角色名、情绪、台词之间用 | 分隔，全部在一行内
3. 角色名必须输出完整全名，不允许省略（如"城崎诺亚"不能只写"诺亚"）
4. 角色名是头像关联的唯一标识，每次输出必须完全一致
5. 只有名没有姓的角色直接写名字（如"云儿"）
6. 台词必须用 [ ] 方括号包裹
7. 旁白和叙述文字正常书写，不加任何标记
8. 每次角色说话都必须带上 @bubble 标记，不可省略
9. 多个角色说话时，每个角色分别使用自己的角色名，包括系统声音
10. 角色的内心活动或心理描写也要使用此格式，写法为 @bubble:角色名|情绪|[*内心活动*]
11. 心里话只按 *...* 外层结构识别
12. 台词中不能包含 | 符号和 [ ] 符号
13. 情绪字段不能省略，必须填写
14. 如果场景内出现路人/同学/同事这类不重要的NPC，则使用@bubble:男/女路人X|情绪|[对白]/@bubble:男/女同学X|情绪|[对白]/@bubble:男/女同事X|情绪|[对白]
15. 如果场景内出现敌人，如果是怪物类型敌人，则使用@bubble:怪物名X|情绪|[对白]，例如：@bubble:夜魔A|生气|[你！]，如果是路人/同学/同事型敌人和14一样
16. 如果是不知道名字的角色或者角色名字在后文现在还没出现名字的角色，都用@bubble:？？？|情绪|[对白]或者@bubble:？？？|情绪|[*内心活动*]代替

[正文标签规则]
<content> 标签外面必须包一层 <now_plot> 标签。

输出结构：
<now_plot>
<content>
（正文内容）
</content>
</now_plot>

示例：
<now_plot>
<content>
诺亚傻站着愣了半秒，忽闪着大眼睛直勾勾盯着我。

@bubble:城崎诺亚|欣喜|[咦？真的吗？]

@bubble:城崎诺亚|紧张|[*（我真的能做好吗？）*]

她似乎在脑海里搜索着相关的经验，过了一会儿，她居然真的点了点头。

@bubble:城崎诺亚|开心|[听起来好像挺简单的。那诺亚试试看好了！]

樱在旁边叹了口气，看起来并不想掺和这件事。

@bubble:樱|无奈|[别把我拉进去啊。]

@bubble:？？？|兴奋|[喂！你们！]

@bubble:男同学A|慌张|[是……是清野同学，我们该撤了]

@bubble:男同学B|紧张|[对，你们先聊，我们走了]

那两个同学飞快的跑了，几人看到清野飞快的跑了过来

@bubble:清野|兴奋|[刚刚你们在这边干什么呢！]

</content>
</now_plot>`;

// ===== v7.0 默认情绪词提示词模板 =====
// 模板中 {{mood_groups}} 会在注入时被替换为实际的情绪词分组列表
const DEFAULT_MOOD_PROMPT_TEMPLATE = `[情绪词约束——严格执行]
@bubble 格式中的「情绪」字段必须且只能从以下固定词池中逐字选取，禁止自造、改写、组合：

{{mood_groups}}

选词规则：
1. 必须原样使用词池中的词，不可变形（如不能把"开心"写成"开心地"或"有点开心"）
2. 每次只填一个词，不可组合（如不能写"开心害羞"）
3. 如果角色的情绪不完全匹配任何词，选最接近的那个词
4. 绝对禁止使用词池外的词（如"微笑""冷笑""苦笑""平淡""严肃"等都是禁止的，除非它们出现在上面的词池中）
5. 不确定时优先选择该情绪分类中最通用的第一个词（如喜悦组选"开心"，悲伤组选"难过"）

❌ 错误示例（以下写法全部禁止）：
@bubble:角色名|微笑|[台词]  ← "微笑"不在词池中
@bubble:角色名|高兴|[台词]  ← "高兴"不在词池中，应使用"开心"
@bubble:角色名|冷笑|[台词]  ← "冷笑"不在词池中，应使用"不屑"
@bubble:角色名|平淡|[台词]  ← "平淡"不在词池中，应使用"平静"
@bubble:角色名|严肃|[台词]  ← "严肃"不在词池中，应使用"冷静"

情绪字段不能省略，必须填写。违反以上规则的输出将无法被正确渲染。`;

function getCurrentContext() {
  function tryGetContext(target) {
    try {
      if (target && target.SillyTavern && typeof target.SillyTavern.getContext === 'function') {
        return target.SillyTavern.getContext();
      }
    } catch (e) {}
    return null;
  }

  try {
    const localContext = tryGetContext(window);
    if (localContext) return localContext;
    if (window.parent && window.parent !== window) {
      const parentContext = tryGetContext(window.parent);
      if (parentContext) return parentContext;
    }
  } catch (e) {}
  return null;
}

function getCurrentCharId() {
  function tryGetChid(target) {
    try {
      if (target && typeof target.this_chid !== 'undefined' && target.this_chid !== null) {
        return target.this_chid;
      }
    } catch (e) {}
    return undefined;
  }

  try {
    const context = getCurrentContext();
    let chid = context?.characterId ?? tryGetChid(window);
    if (chid == null && window.parent && window.parent !== window) {
      chid = tryGetChid(window.parent);
    }
    return chid != null ? String(chid) : '';
  } catch (e) {
    return '';
  }
}

function getCurrentCharName() {
  try {
    const context = getCurrentContext();
    return context?.name2 || '未知角色卡';
  } catch (e) {
    return '未知角色卡';
  }
}

function buildAvatarKey(charId, name) {
  const safeCharId = String(charId || GLOBAL_CHAR_ID);
  const safeName = name.trim().toLowerCase();
  return safeCharId + CHAR_ID_SEPARATOR + safeName;
}

function buildMoodAvatarKey(charId, name, moodId) {
  const safeCharId = String(charId || GLOBAL_CHAR_ID);
  const safeName = name.trim().toLowerCase();
  return safeCharId + CHAR_ID_SEPARATOR + safeName + CHAR_ID_SEPARATOR + moodId;
}

function buildColorConfigKey(charId, name) {
  const safeCharId = String(charId || GLOBAL_CHAR_ID);
  const safeName = name.trim().toLowerCase();
  return 'color_' + safeCharId + CHAR_ID_SEPARATOR + safeName;
}

function buildLive2DConfigKey(charId) {
  return 'live2d_' + String(charId || GLOBAL_CHAR_ID);
}

function extractDisplayName(storedKey, charId) {
  // 有 charId 时精确切割
  if (charId != null) {
    const prefix = String(charId) + CHAR_ID_SEPARATOR;
    if (storedKey.startsWith(prefix)) return storedKey.slice(prefix.length);
  }
  // 尝试 _global_ 前缀
  const globalPrefix = GLOBAL_CHAR_ID + CHAR_ID_SEPARATOR;
  if (storedKey.startsWith(globalPrefix)) return storedKey.slice(globalPrefix.length);
  // 回退：数字型 charId 不含下划线，第一个 __ 就是分隔符
  const sepIndex = storedKey.indexOf(CHAR_ID_SEPARATOR);
  return sepIndex >= 0 ? storedKey.slice(sepIndex + CHAR_ID_SEPARATOR.length) : storedKey;
}

function escapeHtmlAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const FONT_CACHE_PREFIX = 'bubbleDialogueFontCache:';
const FONT_FETCH_TIMEOUT_MS = 8000;
const STYLE_CACHE_KEY = 'bubbleDialogueStyleSnapshot';
const STYLE_DEFAULTS = {
  style_dialogueFontSize: 14.5,
  style_narrationFontSize: 14,
  style_dialogueSpacing: 10,
  style_textColorMode: 'global',
  style_globalTextColor: '#d9d9d9',
  style_markdownMode: 'basic',
  style_dialogueFontWeight: 400,
  style_narrationFontWeight: 400,
  style_nameFontWeight: 800,
  style_narrationBgColor: '#ffffff',
  style_narrationBgOpacity: 0.04,
  style_avatarSize: 52,
  style_narrationIndent: 76,
  style_narrationFontFamily: 'Noto Sans SC',
  style_dialogueFontFamily: 'Noto Serif SC',
  style_nameFontFamily: 'Noto Serif SC',
  style_fontConfigUrl: '',
  style_narrationBorderRadius: 0,
  style_avatarShape: 'rounded',
  style_thoughtSuffixGap: 6,
  style_thoughtSuffixOffsetY: 5,
  // v7.0
  style_narrationTextIndent: 0,
  style_narrationLineHeight: 1.75,
  style_narrationPaddingRight: 16,
  style_imageCompressEnabled: true,
  style_imageCompressQuality: 0.82,
};
const STYLE_CONFIG_KEYS = Object.freeze(Object.keys(STYLE_DEFAULTS));
const BUILTIN_FONT_OPTIONS = [
  { id: 'noto-sans-sc', name: 'Noto Sans SC', family: 'Noto Sans SC', type: 'builtin' },
  { id: 'source-han-sans-sc', name: 'Source Han Sans SC', family: 'Source Han Sans SC', type: 'builtin' },
  { id: 'noto-serif-sc', name: 'Noto Serif SC', family: 'Noto Serif SC', type: 'builtin' },
  { id: 'source-han-serif-sc', name: 'Source Han Serif SC', family: 'Source Han Serif SC', type: 'builtin' },
  { id: 'lxgw-wenkai', name: 'LXGW WenKai', family: 'LXGW WenKai', type: 'builtin' },
  { id: 'fira-code', name: 'Fira Code', family: 'Fira Code', type: 'builtin' }
];

// ===== ZIP 工具函数（store 模式，无压缩） =====
// 图片文件本身已是压缩格式（webp/jpeg/png），不需要 deflate 再压缩

const _zipCrc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function zipCrc32(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) crc = _zipCrc32Table[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 将文件列表打包为 ZIP Blob（store 模式，无压缩）
 * @param {Array<{name: string, data: Uint8Array}>} files - 文件列表
 * @returns {Blob} ZIP 文件 Blob
 */
function zipCreate(files) {
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = zipCrc32(file.data);
    const size = file.data.length;

    // Local file header (30 + nameLen + data)
    const local = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034B50, true);   // 签名
    lv.setUint16(4, 20, true);            // 版本
    lv.setUint16(6, 0, true);             // 标志
    lv.setUint16(8, 0, true);             // 压缩方法: store
    lv.setUint16(10, 0, true);            // 修改时间
    lv.setUint16(12, 0, true);            // 修改日期
    lv.setUint32(14, crc, true);          // CRC-32
    lv.setUint32(18, size, true);         // 压缩大小
    lv.setUint32(22, size, true);         // 原始大小
    lv.setUint16(26, nameBytes.length, true); // 文件名长度
    lv.setUint16(28, 0, true);            // 额外字段长度
    new Uint8Array(local, 30).set(nameBytes);
    localHeaders.push(new Uint8Array(local));

    // Central directory header (46 + nameLen)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014B50, true);    // 签名
    cv.setUint16(4, 20, true);            // 创建版本
    cv.setUint16(6, 20, true);            // 解压版本
    cv.setUint16(8, 0, true);             // 标志
    cv.setUint16(10, 0, true);            // 压缩方法: store
    cv.setUint16(12, 0, true);            // 修改时间
    cv.setUint16(14, 0, true);            // 修改日期
    cv.setUint32(16, crc, true);          // CRC-32
    cv.setUint32(20, size, true);         // 压缩大小
    cv.setUint32(24, size, true);         // 原始大小
    cv.setUint16(28, nameBytes.length, true); // 文件名长度
    cv.setUint16(30, 0, true);            // 额外字段长度
    cv.setUint16(32, 0, true);            // 文件注释长度
    cv.setUint16(34, 0, true);            // 磁盘编号
    cv.setUint16(36, 0, true);            // 内部属性
    cv.setUint32(38, 0, true);            // 外部属性
    cv.setUint32(42, offset, true);       // 本地头偏移
    new Uint8Array(central, 46).set(nameBytes);
    centralHeaders.push(new Uint8Array(central));

    offset += 30 + nameBytes.length + size;
  }

  // End of central directory (22 bytes)
  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054B50, true);      // 签名
  ev.setUint16(4, 0, true);               // 磁盘编号
  ev.setUint16(6, 0, true);               // 中央目录磁盘
  ev.setUint16(8, files.length, true);     // 本磁盘条目数
  ev.setUint16(10, files.length, true);    // 总条目数
  ev.setUint32(12, centralDirSize, true);  // 中央目录大小
  ev.setUint32(16, centralDirOffset, true);// 中央目录偏移
  ev.setUint16(20, 0, true);              // 注释长度

  // 组装最终 Blob
  const parts = [];
  for (let i = 0; i < files.length; i++) {
    parts.push(localHeaders[i]);
    parts.push(files[i].data);
  }
  for (const ch of centralHeaders) parts.push(ch);
  parts.push(new Uint8Array(eocd));

  return new Blob(parts, { type: 'application/zip' });
}

/**
 * 从 ZIP Blob 中逐文件提取（store 模式）
 * @param {ArrayBuffer} buffer - ZIP 文件的 ArrayBuffer
 * @returns {Map<string, Uint8Array>} 文件名 -> 文件数据的 Map
 */
function zipExtract(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map();

  // 从末尾查找 EOCD 签名
  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('无效的 ZIP 文件：找不到 EOCD 签名');

  const entryCount = dv.getUint16(eocdOffset + 10, true);
  let cdOffset = dv.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(cdOffset, true) !== 0x02014B50) throw new Error('ZIP 中央目录损坏');
    const method = dv.getUint16(cdOffset + 10, true);
    const crc = dv.getUint32(cdOffset + 16, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localOffset = dv.getUint32(cdOffset + 42, true);
    const name = decoder.decode(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    if (method !== 0) throw new Error(`ZIP 条目 "${name}" 使用了不支持的压缩方法 ${method}，仅支持 store 模式`);

    // 从 local header 中读取实际数据偏移
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    const data = u8.slice(dataOffset, dataOffset + compSize);

    // CRC32 校验
    const actualCrc = zipCrc32(data);
    if (actualCrc !== crc) throw new Error(`ZIP 条目 "${name}" CRC32 校验失败（期望 ${crc}，实际 ${actualCrc}）`);

    files.set(name, data);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

async function zipInflateDeflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持解压 deflate ZIP，请使用未压缩 ZIP 或直接选择模型目录');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 从 ZIP Blob 中逐文件提取（支持 store 与 deflate）
 * @param {ArrayBuffer} buffer - ZIP 文件的 ArrayBuffer
 * @returns {Promise<Map<string, Uint8Array>>} 文件名 -> 文件数据的 Map
 */
async function zipExtractAsync(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map();

  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('无效的 ZIP 文件：找不到 EOCD 签名');

  const entryCount = dv.getUint16(eocdOffset + 10, true);
  let cdOffset = dv.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(cdOffset, true) !== 0x02014B50) throw new Error('ZIP 中央目录损坏');
    const method = dv.getUint16(cdOffset + 10, true);
    const crc = dv.getUint32(cdOffset + 16, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const uncompSize = dv.getUint32(cdOffset + 24, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localOffset = dv.getUint32(cdOffset + 42, true);
    const name = decoder.decode(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    const compressedData = u8.slice(dataOffset, dataOffset + compSize);
    let data;
    if (method === 0) data = compressedData;
    else if (method === 8) data = await zipInflateDeflateRaw(compressedData);
    else throw new Error(`ZIP 条目 "${name}" 使用了不支持的压缩方法 ${method}`);

    if (uncompSize !== 0xFFFFFFFF && data.length !== uncompSize) {
      throw new Error(`ZIP 条目 "${name}" 解压大小不一致（期望 ${uncompSize}，实际 ${data.length}）`);
    }
    const actualCrc = zipCrc32(data);
    if (actualCrc !== crc) throw new Error(`ZIP 条目 "${name}" CRC32 校验失败（期望 ${crc}，实际 ${actualCrc}）`);

    if (!name.endsWith('/')) files.set(name, data);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

/** mimeType 转文件扩展名 */
function mimeToExt(mime) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/avif': '.avif' };
  return map[mime] || '.bin';
}

/** 文件扩展名转 mimeType */
function extToMime(ext) {
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };
  return map[ext.toLowerCase()] || 'image/webp';
}

/** 安全化文件名（去除路径分隔符和特殊字符） */
function safeFileName(name) {
  return (name || 'unnamed').replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

async function compressImage(blob, options = {}) {
  const {
    quality = STYLE_DEFAULTS.style_imageCompressQuality,
    skipBelowKB = 50,
    enabled = true
  } = options;
  if (!enabled) return blob;
  if (blob.size < skipBelowKB * 1024) return blob;
  if (blob.type === 'image/gif') return blob;
  // WebP 快速跳过：已经是目标格式，解码再重编码只会浪费时间且质量有损
  if (blob.type === 'image/webp') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const compressed = await canvas.convertToBlob({ type: 'image/webp', quality });
    if (compressed.size >= blob.size) return blob;
    return compressed;
  } catch (e) {
    console.warn('[compressImage] 压缩失败，使用原图:', e);
    return blob;
  }
}

async function getCompressOptions(db) {
  try {
    const enabled = await db.getConfig('style_imageCompressEnabled', STYLE_DEFAULTS.style_imageCompressEnabled);
    const quality = await db.getConfig('style_imageCompressQuality', STYLE_DEFAULTS.style_imageCompressQuality);
    return { enabled: enabled !== false && enabled !== 'false', quality: Number(quality) || 0.82 };
  } catch (_) {
    return { enabled: true, quality: 0.82 };
  }
}

function hexToRgba(hex, opacity) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
    return `rgba(255,255,255,${clampNumber(opacity, 0, 1)})`;
  }
  const safeOpacity = clampNumber(opacity, 0, 1);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${safeOpacity})`;
}

function normalizeFontPayload(payload) {
  const fonts = Array.isArray(payload?.fonts) ? payload.fonts : [];
  return fonts
    .map((item, index) => {
      const family = typeof item?.family === 'string' ? item.family.trim() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : family;
      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      const type = item?.type === 'file' ? 'file' : item?.type === 'css' ? 'css' : '';
      const format = typeof item?.format === 'string' ? item.format.trim() : '';
      const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `remote-font-${index}`;
      if (!family || !name || !url || !type) return null;
      return { id, name, family, url, type, format };
    })
    .filter(Boolean);
}

function readStyleSnapshot() {
  try {
    const raw = localStorage.getItem(STYLE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeStyleSnapshot(settings, { replace = false } = {}) {
  try {
    const next = replace ? {} : readStyleSnapshot();
    STYLE_CONFIG_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = settings[key];
    });
    localStorage.setItem(STYLE_CACHE_KEY, JSON.stringify(next));
  } catch (_) {
    // ignore local cache errors
  }
}

function clearStyleSnapshot() {
  try {
    localStorage.removeItem(STYLE_CACHE_KEY);
  } catch (_) {
    // ignore local cache errors
  }
}

class AvatarDB {
  constructor() {
    this.db = null;
    this._blobUrlCache = new Map();
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const tx = event.target.transaction;
        if (!db.objectStoreNames.contains(STORE_AVATARS)) {
          const store = db.createObjectStore(STORE_AVATARS, { keyPath: 'alias' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_MOOD_AVATARS)) {
          const moodStore = db.createObjectStore(STORE_MOOD_AVATARS, { keyPath: 'id' });
          moodStore.createIndex('charId', 'charId', { unique: false });
          moodStore.createIndex('alias', 'alias', { unique: false });
          moodStore.createIndex('moodId', 'moodId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_LOCAL_FONTS)) {
          db.createObjectStore(STORE_LOCAL_FONTS, { keyPath: 'id' });
        }
        // v7.0: CG 图片库
        if (!db.objectStoreNames.contains(STORE_CG_GROUPS)) {
          db.createObjectStore(STORE_CG_GROUPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CG_IMAGES)) {
          const cgImgStore = db.createObjectStore(STORE_CG_IMAGES, { keyPath: 'id' });
          cgImgStore.createIndex('group', 'group', { unique: false });
        }
        if (event.oldVersion < 2) {
          const avatarStore = tx.objectStore(STORE_AVATARS);
          const cursorReq = avatarStore.openCursor();
          const toDelete = [];
          const toAdd = [];
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              if (!record.alias.includes(CHAR_ID_SEPARATOR)) {
                toDelete.push(record.alias);
                toAdd.push({ ...record, alias: GLOBAL_CHAR_ID + CHAR_ID_SEPARATOR + record.alias });
              }
              cursor.continue();
            } else {
              for (const key of toDelete) avatarStore.delete(key);
              for (const rec of toAdd) avatarStore.put(rec);
              const configStore = tx.objectStore(STORE_CONFIG);
              const cfgCursorReq = configStore.openCursor();
              const cfgToDelete = [];
              const cfgToAdd = [];
              cfgCursorReq.onsuccess = (ce) => {
                const cfgCursor = ce.target.result;
                if (cfgCursor) {
                  const cfgRecord = cfgCursor.value;
                  if (cfgRecord.key.startsWith('color_') && !cfgRecord.key.includes(CHAR_ID_SEPARATOR)) {
                    const rawAlias = cfgRecord.key.slice(6);
                    cfgToDelete.push(cfgRecord.key);
                    cfgToAdd.push({ ...cfgRecord, key: 'color_' + GLOBAL_CHAR_ID + CHAR_ID_SEPARATOR + rawAlias });
                  }
                  cfgCursor.continue();
                } else {
                  for (const key of cfgToDelete) configStore.delete(key);
                  for (const rec of cfgToAdd) configStore.put(rec);
                }
              };
            }
          };
        }
      };
      request.onsuccess = (event) => { this.db = event.target.result; resolve(this.db); };
      request.onerror = (event) => { reject(new Error(`IndexedDB 打开失败: ${event.target.error}`)); };
    });
  }

  async _ensureDB() { if (!this.db) await this.init(); }

  // -------------------- 头像 CRUD --------------------

  async add(charId, name, imageBlob, metadata = {}) {
    await this._ensureDB();
    const key = buildAvatarKey(charId, name);
    const existing = await this.get(charId, name);
    if (existing) throw new Error(`角色名 "${name}" 已存在，请使用 update() 或换一个角色名`);
    const record = {
      alias: key, imageBlob,
      sourceUrl: metadata.sourceUrl || null,
      mimeType: imageBlob ? (imageBlob.type || 'image/jpeg') : (metadata.mimeType || 'image/webp'),
      fileName: metadata.fileName || `${name.trim().toLowerCase()}.jpg`,
      fileSize: imageBlob ? imageBlob.size : 0,
      width: metadata.width || 0,
      height: metadata.height || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return this._put(STORE_AVATARS, record);
  }

  async get(charId, name) {
    await this._ensureDB();
    const key = buildAvatarKey(charId, name);
    return this._getByKey(STORE_AVATARS, key);
  }

  async getBlobUrl(charId, name) {
    const key = buildAvatarKey(charId, name);
    if (this._blobUrlCache.has(key)) return this._blobUrlCache.get(key);
    const record = await this.get(charId, name);
    if (!record || !record.imageBlob) return null;
    const url = URL.createObjectURL(record.imageBlob);
    this._blobUrlCache.set(key, url);
    return url;
  }

  async update(charId, name, imageBlob, metadata = {}) {
    await this._ensureDB();
    const key = buildAvatarKey(charId, name);
    const existing = await this.get(charId, name);
    if (!existing) throw new Error(`角色名 "${name}" 不存在`);
    this._revokeCachedUrl(key);
    const record = {
      ...existing, imageBlob,
      sourceUrl: metadata.sourceUrl !== undefined ? metadata.sourceUrl : (existing.sourceUrl || null),
      mimeType: imageBlob.type || existing.mimeType,
      fileName: metadata.fileName || existing.fileName,
      fileSize: imageBlob.size,
      width: metadata.width || existing.width,
      height: metadata.height || existing.height,
      updatedAt: Date.now()
    };
    return this._put(STORE_AVATARS, record);
  }

  async rename(charId, oldName, newName) {
    await this._ensureDB();
    const oldKey = buildAvatarKey(charId, oldName);
    const newKey = buildAvatarKey(charId, newName);
    if (oldKey === newKey) return;
    if (await this.get(charId, newName)) throw new Error(`角色名 "${newName}" 已被占用`);
    const record = await this.get(charId, oldName);
    if (!record) throw new Error(`角色名 "${oldName}" 不存在`);
    this._revokeCachedUrl(oldKey);
    const newRecord = { ...record, alias: newKey, updatedAt: Date.now() };
    const tx = this.db.transaction(STORE_AVATARS, 'readwrite');
    const store = tx.objectStore(STORE_AVATARS);
    return new Promise((resolve, reject) => {
      const del = store.delete(oldKey);
      del.onsuccess = () => {
        const add = store.put(newRecord);
        add.onsuccess = () => resolve();
        add.onerror = () => reject(new Error(`重命名写入失败`));
      };
      del.onerror = () => reject(new Error(`重命名删除失败`));
    });
  }

  async delete(charId, name) {
    await this._ensureDB();
    const key = buildAvatarKey(charId, name);
    this._revokeCachedUrl(key);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_AVATARS, 'readwrite');
      const req = tx.objectStore(STORE_AVATARS).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`删除失败`));
    });
  }

  async list(charId) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const prefix = safeCharId + CHAR_ID_SEPARATOR;
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll(range);
      req.onsuccess = () => {
        resolve(req.result.map(r => ({
          alias: r.alias, displayName: extractDisplayName(r.alias, safeCharId),
          mimeType: r.mimeType, fileName: r.fileName,
          fileSize: r.fileSize, width: r.width, height: r.height,
          createdAt: r.createdAt, updatedAt: r.updatedAt
        })));
      };
      req.onerror = () => reject(new Error(`列表查询失败`));
    });
  }

  async getStats(charId) {
    await this._ensureDB();
    const prefix = String(charId || GLOBAL_CHAR_ID) + CHAR_ID_SEPARATOR;
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll(range);
      req.onsuccess = () => {
        const records = req.result;
        resolve({ count: records.length, totalSize: records.reduce((s, r) => s + (r.fileSize || 0), 0) });
      };
      req.onerror = () => reject(new Error(`统计查询失败`));
    });
  }

  // -------------------- 情绪差分头像 CRUD --------------------

  async addMoodAvatar(charId, name, moodId, imageBlob, metadata = {}) {
    await this._ensureDB();
    const id = buildMoodAvatarKey(charId, name, moodId);
    const safeName = name.trim().toLowerCase();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const record = {
      id, charId: safeCharId, alias: safeName, moodId,
      imageBlob,
      mimeType: imageBlob ? (imageBlob.type || 'image/jpeg') : (metadata.mimeType || 'image/webp'),
      fileName: metadata.fileName || `${safeName}-${moodId}.jpg`,
      fileSize: imageBlob ? imageBlob.size : 0,
      width: metadata.width || 0,
      height: metadata.height || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return this._put(STORE_MOOD_AVATARS, record);
  }

  async getMoodAvatar(charId, name, moodId) {
    await this._ensureDB();
    const id = buildMoodAvatarKey(charId, name, moodId);
    return this._getByKey(STORE_MOOD_AVATARS, id);
  }

  async getMoodAvatarBlobUrl(charId, name, moodId) {
    const cacheKey = 'mood_' + buildMoodAvatarKey(charId, name, moodId);
    if (this._blobUrlCache.has(cacheKey)) return this._blobUrlCache.get(cacheKey);
    const record = await this.getMoodAvatar(charId, name, moodId);
    if (!record || !record.imageBlob) return null;
    const url = URL.createObjectURL(record.imageBlob);
    this._blobUrlCache.set(cacheKey, url);
    return url;
  }

  async listMoodAvatars(charId, name) {
    await this._ensureDB();
    const safeName = name.trim().toLowerCase();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_MOOD_AVATARS, 'readonly');
      const index = tx.objectStore(STORE_MOOD_AVATARS).index('charId');
      const req = index.getAll(IDBKeyRange.only(safeCharId));
      req.onsuccess = () => {
        resolve(req.result.filter(r => r.alias === safeName));
      };
      req.onerror = () => reject(new Error(`情绪差分列表查询失败`));
    });
  }

  async deleteMoodAvatar(charId, name, moodId) {
    await this._ensureDB();
    const id = buildMoodAvatarKey(charId, name, moodId);
    const cacheKey = 'mood_' + id;
    if (this._blobUrlCache.has(cacheKey)) {
      URL.revokeObjectURL(this._blobUrlCache.get(cacheKey));
      this._blobUrlCache.delete(cacheKey);
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_MOOD_AVATARS, 'readwrite');
      const req = tx.objectStore(STORE_MOOD_AVATARS).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`情绪差分删除失败`));
    });
  }

  async deleteAllMoodAvatars(charId, name) {
    await this._ensureDB();
    const moodAvatars = await this.listMoodAvatars(charId, name);
    const tx = this.db.transaction(STORE_MOOD_AVATARS, 'readwrite');
    const store = tx.objectStore(STORE_MOOD_AVATARS);
    for (const ma of moodAvatars) {
      store.delete(ma.id);
      const cacheKey = 'mood_' + ma.id;
      if (this._blobUrlCache.has(cacheKey)) {
        URL.revokeObjectURL(this._blobUrlCache.get(cacheKey));
        this._blobUrlCache.delete(cacheKey);
      }
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`情绪差分批量删除失败`));
    });
  }

  // -------------------- 本地字体 CRUD --------------------

  _buildLocalFontId(family) {
    return 'local__' + family.trim();
  }

  async addLocalFont(family, fontBlob, metadata = {}) {
    await this._ensureDB();
    const id = this._buildLocalFontId(family);
    const ext = (metadata.fileName || '').split('.').pop()?.toLowerCase() || '';
    const record = {
      id, family: family.trim(), name: metadata.name || family.trim(),
      fontBlob,
      mimeType: metadata.mimeType || FONT_EXT_MIME_MAP[ext] || 'application/octet-stream',
      fileName: metadata.fileName || `${family}.${ext || 'woff2'}`,
      fileSize: fontBlob.size,
      format: FONT_EXT_FORMAT_MAP[ext] || '',
      createdAt: Date.now(),
    };
    return this._put(STORE_LOCAL_FONTS, record);
  }

  async getLocalFont(family) {
    await this._ensureDB();
    const id = this._buildLocalFontId(family);
    return this._getByKey(STORE_LOCAL_FONTS, id);
  }

  async listLocalFonts() {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_LOCAL_FONTS, 'readonly').objectStore(STORE_LOCAL_FONTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(new Error('本地字体列表查询失败'));
    });
  }

  async deleteLocalFont(family) {
    await this._ensureDB();
    const id = this._buildLocalFontId(family);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_LOCAL_FONTS, 'readwrite');
      const req = tx.objectStore(STORE_LOCAL_FONTS).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error('本地字体删除失败'));
    });
  }

  // -------------------- CSS 字体源管理 --------------------

  async getCssFontSources() {
    const raw = await this.getConfig('style_cssFontUrls', '[]');
    try { return JSON.parse(raw); } catch (_) { return []; }
  }

  async addCssFontSource(url, families) {
    const sources = await this.getCssFontSources();
    const existing = sources.findIndex(s => s.url === url);
    const entry = { url, families: families || [], importedAt: Date.now() };
    if (existing >= 0) sources[existing] = entry;
    else sources.push(entry);
    await this.setConfig('style_cssFontUrls', JSON.stringify(sources));
  }

  async deleteCssFontSource(url) {
    const sources = await this.getCssFontSources();
    const filtered = sources.filter(s => s.url !== url);
    await this.setConfig('style_cssFontUrls', JSON.stringify(filtered));
  }

  // -------------------- 配置管理 --------------------

  async getConfig(key, defaultValue = null) {
    await this._ensureDB();
    const record = await this._getByKey(STORE_CONFIG, key);
    return record ? record.value : defaultValue;
  }

  async setConfig(key, value) {
    await this._ensureDB();
    const result = await this._put(STORE_CONFIG, { key, value });
    if (STYLE_CONFIG_KEYS.includes(key)) {
      writeStyleSnapshot({ [key]: value });
    }
    return result;
  }

  async getAllConfig() {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).getAll();
      req.onsuccess = () => {
        const config = {};
        req.result.forEach(r => { config[r.key] = r.value; });
        resolve(config);
      };
      req.onerror = () => reject(new Error(`配置查询失败`));
    });
  }

  // -------------------- 导入导出（v6.0 三文件拆分） --------------------

  _downloadJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _downloadZipFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 10000);
  }

  // --- 角色卡配置 ---
  async exportCharacterData(charId, { urlOnly = false } = {}) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const prefix = safeCharId + CHAR_ID_SEPARATOR;

    const allAvatars = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('导出失败'));
    });
    const avatars = [];
    for (const r of allAvatars.filter(r => r.alias.startsWith(prefix))) {
      const entry = {
        name: extractDisplayName(r.alias, safeCharId), mimeType: r.mimeType, fileName: r.fileName,
        fileSize: r.fileSize, width: r.width, height: r.height,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        imageUrl: r.sourceUrl || null,
        imageBase64: (urlOnly && r.sourceUrl) ? null : await this._blobToBase64(r.imageBlob)
      };
      avatars.push(entry);
    }

    const allMoodAvatars = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_MOOD_AVATARS, 'readonly').objectStore(STORE_MOOD_AVATARS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('情绪差分导出失败'));
    });
    const moodAvatars = [];
    for (const r of allMoodAvatars.filter(r => r.charId === safeCharId)) {
      moodAvatars.push({
        name: r.alias, moodId: r.moodId, mimeType: r.mimeType, fileName: r.fileName,
        fileSize: r.fileSize, width: r.width, height: r.height,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        imageUrl: r.sourceUrl || null,
        imageBase64: (urlOnly && r.sourceUrl) ? null : await this._blobToBase64(r.imageBlob)
      });
    }

    const allConfig = await this.getAllConfig();
    const colors = {};
    const colorPrefix = 'color_' + prefix;
    for (const [k, v] of Object.entries(allConfig)) {
      if (k.startsWith(colorPrefix)) {
        colors[k.slice(colorPrefix.length)] = v;
      }
    }

    // v7.0: CG groups（含本地上传图片的 base64）
    const cgGroups = await this.listCgGroups(safeCharId);
    const cgGroupsExport = [];
    for (const g of cgGroups) {
      const entry = { group: g.group, albumUrl: g.albumUrl, localImages: [] };
      const urls = g.imageUrls || [];
      for (let i = 0; i < urls.length; i++) {
        if (urls[i].startsWith('local://')) {
          const cached = await this.getCgImage(g.group, i + 1);
          if (cached && cached.imageBlob) {
            entry.localImages.push({
              index: i + 1,
              fileName: urls[i].replace('local://', ''),
              mimeType: cached.mimeType || 'image/webp',
              imageBase64: await this._blobToBase64(cached.imageBlob)
            });
          }
        }
      }
      if (!entry.localImages.length) delete entry.localImages;
      cgGroupsExport.push(entry);
    }

    return {
      type: 'bubble-character',
      version: '7.0',
      exportedAt: new Date().toISOString(),
      charId: safeCharId,
      charName: getCurrentCharName(),
      avatars,
      moodAvatars,
      colors,
      cgGroups: cgGroupsExport.length ? cgGroupsExport : undefined
    };
  }

  async exportCharacterDataToFile(charId, onProgress) {
    await this._exportCharacterDataToZip(charId, onProgress);
  }

  /**
   * 将角色数据导出为 ZIP 格式（图片以二进制文件存储，不再用 base64）
   * ZIP 结构：
   *   manifest.json          — 元数据（不含图片数据）
   *   avatars/0_name.webp    — 头像图片
   *   mood/0_name_moodId.webp — 情绪差分头像
   *   cg/group/1_file.webp   — CG 本地图片
   */
  async _exportCharacterDataToZip(charId, onProgress) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const prefix = safeCharId + CHAR_ID_SEPARATOR;
    const zipFiles = [];
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};

    _progress('正在读取数据...');

    // ---- 头像 ----
    const allAvatars = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('导出失败'));
    });
    const avatarsMeta = [];
    let avatarIdx = 0;
    const filteredAvatars = allAvatars.filter(r => r.alias.startsWith(prefix));
    for (const r of filteredAvatars) {
      const displayName = extractDisplayName(r.alias, safeCharId);
      const meta = {
        name: displayName, mimeType: r.mimeType, fileName: r.fileName,
        fileSize: r.fileSize, width: r.width, height: r.height,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        imageUrl: r.sourceUrl || null, zipPath: null
      };
      if (r.imageBlob) {
        const ext = mimeToExt(r.mimeType);
        const zipPath = `avatars/${avatarIdx}_${safeFileName(displayName)}${ext}`;
        const buf = await r.imageBlob.arrayBuffer();
        zipFiles.push({ name: zipPath, data: new Uint8Array(buf) });
        meta.zipPath = zipPath;
      }
      avatarsMeta.push(meta);
      avatarIdx++;
      _progress(`打包头像 ${avatarIdx}/${filteredAvatars.length}`);
    }

    // ---- 情绪差分头像 ----
    const allMoodAvatars = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_MOOD_AVATARS, 'readonly').objectStore(STORE_MOOD_AVATARS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('情绪差分导出失败'));
    });
    const moodAvatarsMeta = [];
    let moodIdx = 0;
    const filteredMood = allMoodAvatars.filter(r => r.charId === safeCharId);
    for (const r of filteredMood) {
      const meta = {
        name: r.alias, moodId: r.moodId, mimeType: r.mimeType, fileName: r.fileName,
        fileSize: r.fileSize, width: r.width, height: r.height,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        imageUrl: r.sourceUrl || null, zipPath: null
      };
      if (r.imageBlob) {
        const ext = mimeToExt(r.mimeType);
        const zipPath = `mood/${moodIdx}_${safeFileName(r.alias)}_${r.moodId}${ext}`;
        const buf = await r.imageBlob.arrayBuffer();
        zipFiles.push({ name: zipPath, data: new Uint8Array(buf) });
        meta.zipPath = zipPath;
      }
      moodAvatarsMeta.push(meta);
      moodIdx++;
      _progress(`打包情绪头像 ${moodIdx}/${filteredMood.length}`);
    }

    // ---- 颜色配置 ----
    const allConfig = await this.getAllConfig();
    const colors = {};
    const colorPrefix = 'color_' + prefix;
    for (const [k, v] of Object.entries(allConfig)) {
      if (k.startsWith(colorPrefix)) colors[k.slice(colorPrefix.length)] = v;
    }

    // ---- CG 组 ----
    const cgGroups = await this.listCgGroups(safeCharId);
    const cgGroupsMeta = [];
    for (const g of cgGroups) {
      const entry = { group: g.group, albumUrl: g.albumUrl, localImages: [] };
      const urls = g.imageUrls || [];
      for (let i = 0; i < urls.length; i++) {
        if (urls[i].startsWith('local://')) {
          const cached = await this.getCgImage(g.group, i + 1);
          if (cached && cached.imageBlob) {
            const origName = urls[i].replace('local://', '');
            const ext = mimeToExt(cached.mimeType || 'image/webp');
            const zipPath = `cg/${safeFileName(g.group)}/${i + 1}_${safeFileName(origName)}${ext}`;
            const buf = await cached.imageBlob.arrayBuffer();
            zipFiles.push({ name: zipPath, data: new Uint8Array(buf) });
            entry.localImages.push({
              index: i + 1, fileName: origName,
              mimeType: cached.mimeType || 'image/webp', zipPath
            });
          }
        }
      }
      if (!entry.localImages.length) delete entry.localImages;
      cgGroupsMeta.push(entry);
    }

    // ---- manifest.json ----
    const manifest = {
      type: 'bubble-character',
      version: '7.1-zip',
      exportedAt: new Date().toISOString(),
      charId: safeCharId,
      charName: getCurrentCharName(),
      avatars: avatarsMeta,
      moodAvatars: moodAvatarsMeta,
      colors,
      cgGroups: cgGroupsMeta.length ? cgGroupsMeta : undefined
    };
    const manifestJson = JSON.stringify(manifest, null, 2);
    const encoder = new TextEncoder();
    zipFiles.unshift({ name: 'manifest.json', data: encoder.encode(manifestJson) });

    // ---- 打包并下载 ----
    _progress('正在生成 ZIP...');
    const zipBlob = zipCreate(zipFiles);
    const charName = manifest.charName || 'unknown';
    const date = new Date().toISOString().slice(0, 10);
    this._downloadZipFile(zipBlob, `bubble-character-${charName}-${date}.zip`);
  }

  async _importCharacterData(data, charId) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const result = { imported: 0, skipped: 0, errors: [] };
    const compOpts = await getCompressOptions(this);

    if (Array.isArray(data.avatars)) {
      for (const item of data.avatars) {
        try {
          const itemName = item.name || item.alias;
          if (item.imageBase64) {
            let blob = this._base64ToBlob(item.imageBase64, item.mimeType);
            blob = await compressImage(blob, compOpts);
            const existing = await this.get(safeCharId, itemName);
            if (existing) {
              await this.update(safeCharId, itemName, blob, { fileName: item.fileName, width: item.width, height: item.height });
            } else {
              await this.add(safeCharId, itemName, blob, { fileName: item.fileName, width: item.width, height: item.height });
            }
          } else if (item.imageUrl) {
            const existing = await this.get(safeCharId, itemName);
            if (existing) {
              await this.update(safeCharId, itemName, existing.imageBlob || null, {
                sourceUrl: item.imageUrl, fileName: item.fileName, width: item.width, height: item.height, mimeType: item.mimeType
              });
            } else {
              await this.add(safeCharId, itemName, null, {
                sourceUrl: item.imageUrl, fileName: item.fileName, width: item.width, height: item.height, mimeType: item.mimeType
              });
            }
          } else { result.skipped++; continue; }
          result.imported++;
        } catch (err) { result.errors.push(`${item.name || item.alias}: ${err.message}`); }
      }
    }

    if (Array.isArray(data.moodAvatars)) {
      for (const item of data.moodAvatars) {
        try {
          const itemName = item.name || item.alias;
          if (item.imageBase64) {
            let blob = this._base64ToBlob(item.imageBase64, item.mimeType);
            blob = await compressImage(blob, compOpts);
            await this.addMoodAvatar(safeCharId, itemName, item.moodId, blob, {
              fileName: item.fileName, width: item.width, height: item.height
            });
          } else if (item.imageUrl) {
            // 情绪差分头像：注册 URL 空壳
            const id = buildMoodAvatarKey(safeCharId, itemName, item.moodId);
            const record = {
              id, charId: safeCharId, alias: itemName.trim().toLowerCase(), moodId: item.moodId,
              imageBlob: null, sourceUrl: item.imageUrl,
              mimeType: item.mimeType || 'image/webp',
              fileName: item.fileName || '',
              fileSize: 0, width: item.width || 0, height: item.height || 0,
              createdAt: Date.now(), updatedAt: Date.now()
            };
            await this._put(STORE_MOOD_AVATARS, record);
          } else { result.skipped++; continue; }
          result.imported++;
        } catch (err) { result.errors.push(`${item.name || item.alias}/${item.moodId}: ${err.message}`); }
      }
    }

    if (data.colors) {
      for (const [name, color] of Object.entries(data.colors)) {
        await this.setConfig(buildColorConfigKey(safeCharId, name), color);
      }
    }

    // v7.0: CG groups + 本地图片还原
    if (Array.isArray(data.cgGroups)) {
      for (const cg of data.cgGroups) {
        try {
          if (cg.group) {
            await this.addCgGroup(cg.group, cg.albumUrl || '', safeCharId);
            if (cg.albumUrl && cg.albumUrl.trim()) {
              try { await ensureCgGroupIndex(this, cg.group); } catch (_) {}
            }
            // 还原本地上传的图片
            if (Array.isArray(cg.localImages)) {
              const groupInfo = await this.getCgGroup(cg.group);
              let urls = groupInfo ? (groupInfo.imageUrls || []) : [];
              let count = groupInfo ? (groupInfo.count || urls.length) : 0;
              for (const img of cg.localImages) {
                if (!img.imageBase64) continue;
                try {
                  let blob = this._base64ToBlob(img.imageBase64, img.mimeType);
                  blob = await compressImage(blob, compOpts);
                  const idx = img.index || (count + 1);
                  await this.putCgImage(cg.group, idx, blob, 'local://' + (img.fileName || idx));
                  // 确保 imageUrls 有对应条目
                  while (urls.length < idx) urls.push('');
                  urls[idx - 1] = 'local://' + (img.fileName || idx);
                  if (idx > count) count = idx;
                } catch (_) {}
              }
              await this.updateCgGroup(cg.group, { count, imageUrls: urls });
            }
            result.imported++;
          }
        } catch (err) { result.errors.push(`CG:${cg.group}: ${err.message}`); }
      }
    }

    return result;
  }

  // --- 样式配置 ---
  async exportStyleSettings() {
    const allConfig = await this.getAllConfig();
    const settings = {};
    for (const key of STYLE_CONFIG_KEYS) {
      settings[key] = allConfig[key] !== undefined ? allConfig[key] : STYLE_DEFAULTS[key];
    }
    return {
      type: 'bubble-style',
      version: '6.0',
      exportedAt: new Date().toISOString(),
      settings
    };
  }

  async exportStyleSettingsToFile() {
    const data = await this.exportStyleSettings();
    const date = new Date().toISOString().slice(0, 10);
    this._downloadJsonFile(data, `bubble-style-${date}.json`);
  }

  async _importStyleSettings(data) {
    if (!data.settings || typeof data.settings !== 'object') throw new Error('样式配置数据无效');
    for (const [key, value] of Object.entries(data.settings)) {
      if (STYLE_CONFIG_KEYS.includes(key)) {
        await this.setConfig(key, value);
      }
    }
    return { imported: Object.keys(data.settings).length };
  }

  // --- 情绪与格式模板 ---
  async exportTemplate() {
    const formatRule = await this.getConfig('format_rule', DEFAULT_FORMAT_RULE);
    const moodConfigRaw = await this.getConfig('mood_config', null);
    let moodConfig;
    if (moodConfigRaw) {
      try { moodConfig = JSON.parse(moodConfigRaw); } catch (_) { moodConfig = null; }
    }
    if (!moodConfig) {
      moodConfig = { version: '6.0', groups: DEFAULT_MOOD_GROUPS.map(g => ({ ...g, words: [...g.words] })) };
    }

    return {
      type: 'bubble-template',
      version: '6.0',
      exportedAt: new Date().toISOString(),
      formatRule,
      moodConfig
    };
  }

  async exportTemplateToFile() {
    const data = await this.exportTemplate();
    const date = new Date().toISOString().slice(0, 10);
    this._downloadJsonFile(data, `bubble-template-${date}.json`);
  }

  async _importTemplate(data) {
    if (data.formatRule !== undefined) {
      await this.setConfig('format_rule', data.formatRule);
    }
    if (data.moodConfig) {
      await this.setConfig('mood_config', JSON.stringify(data.moodConfig));
    }
    invalidateInjectionCache();
    await applyInjection(this);
    return { imported: 1 };
  }

  // --- v7.0: CG 图片库 CRUD ---

  async addCgGroup(group, albumUrl, charId) {
    await this._ensureDB();
    const id = 'cg_group__' + group;
    const record = {
      id, group, albumUrl,
      charId: String(charId || GLOBAL_CHAR_ID),
      count: 0,
      imageUrls: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return this._put(STORE_CG_GROUPS, record);
  }

  async getCgGroup(group) {
    await this._ensureDB();
    const id = 'cg_group__' + group;
    return this._getByKey(STORE_CG_GROUPS, id);
  }

  async listCgGroups(charId) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_CG_GROUPS, 'readonly').objectStore(STORE_CG_GROUPS).getAll();
      req.onsuccess = () => resolve(req.result.filter(g => g.charId === safeCharId));
      req.onerror = () => reject(new Error('CG 组列表查询失败'));
    });
  }

  async updateCgGroup(group, updates) {
    await this._ensureDB();
    const existing = await this.getCgGroup(group);
    if (!existing) throw new Error(`CG 组 "${group}" 不存在`);
    const record = { ...existing, ...updates, updatedAt: Date.now() };
    return this._put(STORE_CG_GROUPS, record);
  }

  async deleteCgGroup(group) {
    await this._ensureDB();
    const id = 'cg_group__' + group;
    // 删除该组所有图片（本地+远程全清）
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CG_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_CG_IMAGES);
      const index = store.index('group');
      const req = index.openCursor(IDBKeyRange.only(group));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('CG 图片清除失败'));
    });
    // 删除组注册
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CG_GROUPS, 'readwrite');
      const req = tx.objectStore(STORE_CG_GROUPS).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error('CG 组删除失败'));
    });
  }

  async getCgImage(group, index) {
    await this._ensureDB();
    const id = 'cg__' + group + '__' + index;
    return this._getByKey(STORE_CG_IMAGES, id);
  }

  async putCgImage(group, index, blob, sourceUrl) {
    await this._ensureDB();
    const id = 'cg__' + group + '__' + index;
    const record = {
      id, group, index,
      imageBlob: blob,
      sourceUrl: sourceUrl || '',
      mimeType: blob.type || 'image/webp',
      fileSize: blob.size,
      cachedAt: Date.now()
    };
    return this._put(STORE_CG_IMAGES, record);
  }

  async clearCgGroupCache(group) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CG_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_CG_IMAGES);
      const index = store.index('group');
      const req = index.openCursor(IDBKeyRange.only(group));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          // 只删远程拉取的，保留本地上传的
          const record = cursor.value;
          if (!record.sourceUrl || !record.sourceUrl.startsWith('local://')) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = async () => {
        try {
          const groupInfo = await this.getCgGroup(group);
          if (groupInfo) {
            const isDirectList = (groupInfo.albumUrl || '').split(/[\n\r]+/).filter(l => l.trim() && IMAGE_EXTS_RE.test(l)).length > 1;
            if (!isDirectList) {
              // 远程清单模式：清空远程 URL 列表但保留本地上传的条目
              const localUrls = (groupInfo.imageUrls || []).filter(u => u.startsWith('local://'));
              await this.updateCgGroup(group, { count: localUrls.length, imageUrls: localUrls });
            }
          }
        } catch (_) {}
        resolve();
      };
      tx.onerror = () => reject(new Error('CG 缓存清除失败'));
    });
  }

  async clearAllCgCache() {
    await this._ensureDB();
    // 只清远程拉取的图片，保留本地上传的
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CG_IMAGES, 'readwrite');
      const store = tx.objectStore(STORE_CG_IMAGES);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!cursor.value.sourceUrl || !cursor.value.sourceUrl.startsWith('local://')) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('CG 全部缓存清除失败'));
    });
    // 远程清单来源的组：清空远程 URL 但保留本地条目
    const allGroups = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_CG_GROUPS, 'readonly').objectStore(STORE_CG_GROUPS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('查询失败'));
    });
    for (const g of allGroups) {
      const localUrls = (g.imageUrls || []).filter(u => u.startsWith('local://'));
      const isDirectList = (g.albumUrl || '').split(/[\n\r]+/).filter(l => l.trim() && IMAGE_EXTS_RE.test(l)).length > 1;
      if (!isDirectList) {
        await this.updateCgGroup(g.group, { count: localUrls.length, imageUrls: localUrls });
      }
    }
  }

  async getCgGroupCacheStats(group) {
    await this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CG_IMAGES, 'readonly');
      const index = tx.objectStore(STORE_CG_IMAGES).index('group');
      const req = index.count(IDBKeyRange.only(group));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('CG 统计失败'));
    });
  }

  // --- 统一导入路由 ---
  async importFromFile(file, charId, onProgress) {
    // 读取文件头 4 字节判断是 ZIP 还是 JSON
    const headerBuf = await file.slice(0, 4).arrayBuffer();
    const headerView = new DataView(headerBuf);
    const isZip = headerView.getUint32(0, true) === 0x04034B50; // PK\x03\x04

    if (isZip) {
      return this._importCharacterDataFromZip(file, charId, onProgress);
    }

    // JSON 格式（向后兼容）
    const data = JSON.parse(await file.text());
    switch (data.type) {
      case 'bubble-character':
        return this._importCharacterData(data, charId);
      case 'bubble-style':
        return this._importStyleSettings(data);
      case 'bubble-template':
        return this._importTemplate(data);
      case 'bubble-cg':
        return this._importCgData(data, charId);
      default:
        if (data.version === '2.0' && Array.isArray(data.avatars)) {
          throw new Error('此文件为 v5.x 旧格式，v6.0 不兼容导入。请使用 v6.0 重新导出。');
        }
        throw new Error('无法识别的文件格式');
    }
  }

  /**
   * 从 ZIP 文件导入角色数据（逐文件处理，内存友好）
   * 每处理完一张图片就释放其 Uint8Array 引用，避免峰值内存过高
   */
  async _importCharacterDataFromZip(file, charId, onProgress) {
    await this._ensureDB();
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const result = { imported: 0, skipped: 0, errors: [] };
    const compOpts = await getCompressOptions(this);
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};

    _progress('正在解压 ZIP...');
    // 解包 ZIP
    const buffer = await file.arrayBuffer();
    const zipEntries = zipExtract(buffer);

    // 读取 manifest.json
    const manifestData = zipEntries.get('manifest.json');
    if (!manifestData) throw new Error('ZIP 文件中缺少 manifest.json');
    const manifest = JSON.parse(new TextDecoder().decode(manifestData));
    zipEntries.delete('manifest.json'); // 释放 manifest 的 Uint8Array

    if (manifest.type !== 'bubble-character') {
      throw new Error(`ZIP 中的 manifest 类型不匹配：期望 bubble-character，实际 ${manifest.type}`);
    }

    // 计算总数用于进度显示
    const totalAvatars = Array.isArray(manifest.avatars) ? manifest.avatars.length : 0;
    const totalMood = Array.isArray(manifest.moodAvatars) ? manifest.moodAvatars.length : 0;
    const totalCgImages = Array.isArray(manifest.cgGroups)
      ? manifest.cgGroups.reduce((sum, cg) => sum + (Array.isArray(cg.localImages) ? cg.localImages.length : 0), 0) : 0;
    const totalItems = totalAvatars + totalMood + totalCgImages;
    let processedItems = 0;

    // ---- 导入头像 ----
    if (Array.isArray(manifest.avatars)) {
      for (const item of manifest.avatars) {
        try {
          const itemName = item.name || item.alias;
          if (item.zipPath && zipEntries.has(item.zipPath)) {
            // 从 ZIP 条目中取出二进制数据，转为 Blob
            const imgData = zipEntries.get(item.zipPath);
            zipEntries.delete(item.zipPath); // 立即释放引用
            const ext = item.zipPath.substring(item.zipPath.lastIndexOf('.'));
            const mime = item.mimeType || extToMime(ext);
            let blob = new Blob([imgData], { type: mime });
            blob = await compressImage(blob, compOpts);
            const existing = await this.get(safeCharId, itemName);
            if (existing) {
              await this.update(safeCharId, itemName, blob, { fileName: item.fileName, width: item.width, height: item.height });
            } else {
              await this.add(safeCharId, itemName, blob, { fileName: item.fileName, width: item.width, height: item.height });
            }
            result.imported++;
          } else if (item.imageUrl) {
            // 仅有 URL 的头像（无本地图片）
            const existing = await this.get(safeCharId, itemName);
            if (existing) {
              await this.update(safeCharId, itemName, existing.imageBlob || null, {
                sourceUrl: item.imageUrl, fileName: item.fileName, width: item.width, height: item.height, mimeType: item.mimeType
              });
            } else {
              await this.add(safeCharId, itemName, null, {
                sourceUrl: item.imageUrl, fileName: item.fileName, width: item.width, height: item.height, mimeType: item.mimeType
              });
            }
            result.imported++;
          } else { result.skipped++; }
          processedItems++;
          _progress(`导入头像 ${processedItems}/${totalItems}`);
        } catch (err) { result.errors.push(`${item.name || item.alias}: ${err.message}`); processedItems++; }
      }
    }

    // ---- 导入情绪差分头像 ----
    if (Array.isArray(manifest.moodAvatars)) {
      for (const item of manifest.moodAvatars) {
        try {
          const itemName = item.name || item.alias;
          if (item.zipPath && zipEntries.has(item.zipPath)) {
            const imgData = zipEntries.get(item.zipPath);
            zipEntries.delete(item.zipPath);
            const ext = item.zipPath.substring(item.zipPath.lastIndexOf('.'));
            const mime = item.mimeType || extToMime(ext);
            let blob = new Blob([imgData], { type: mime });
            blob = await compressImage(blob, compOpts);
            await this.addMoodAvatar(safeCharId, itemName, item.moodId, blob, {
              fileName: item.fileName, width: item.width, height: item.height
            });
            result.imported++;
          } else if (item.imageUrl) {
            const id = buildMoodAvatarKey(safeCharId, itemName, item.moodId);
            const record = {
              id, charId: safeCharId, alias: itemName.trim().toLowerCase(), moodId: item.moodId,
              imageBlob: null, sourceUrl: item.imageUrl,
              mimeType: item.mimeType || 'image/webp',
              fileName: item.fileName || '',
              fileSize: 0, width: item.width || 0, height: item.height || 0,
              createdAt: Date.now(), updatedAt: Date.now()
            };
            await this._put(STORE_MOOD_AVATARS, record);
            result.imported++;
          } else { result.skipped++; }
          processedItems++;
          _progress(`导入情绪头像 ${processedItems}/${totalItems}`);
        } catch (err) { result.errors.push(`${item.name || item.alias}/${item.moodId}: ${err.message}`); processedItems++; }
      }
    }

    // ---- 导入颜色配置 ----
    if (manifest.colors) {
      for (const [name, color] of Object.entries(manifest.colors)) {
        await this.setConfig(buildColorConfigKey(safeCharId, name), color);
      }
    }

    // ---- 导入 CG 组 + 本地图片 ----
    if (Array.isArray(manifest.cgGroups)) {
      for (const cg of manifest.cgGroups) {
        try {
          if (cg.group) {
            await this.addCgGroup(cg.group, cg.albumUrl || '', safeCharId);
            if (cg.albumUrl && cg.albumUrl.trim()) {
              try { await ensureCgGroupIndex(this, cg.group); } catch (_) {}
            }
            if (Array.isArray(cg.localImages)) {
              const groupInfo = await this.getCgGroup(cg.group);
              let urls = groupInfo ? (groupInfo.imageUrls || []) : [];
              let count = groupInfo ? (groupInfo.count || urls.length) : 0;
              for (const img of cg.localImages) {
                if (!img.zipPath || !zipEntries.has(img.zipPath)) continue;
                try {
                  const imgData = zipEntries.get(img.zipPath);
                  zipEntries.delete(img.zipPath);
                  const mime = img.mimeType || 'image/webp';
                  let blob = new Blob([imgData], { type: mime });
                  blob = await compressImage(blob, compOpts);
                  const idx = img.index || (count + 1);
                  await this.putCgImage(cg.group, idx, blob, 'local://' + (img.fileName || idx));
                  while (urls.length < idx) urls.push('');
                  urls[idx - 1] = 'local://' + (img.fileName || idx);
                  if (idx > count) count = idx;
                } catch (_) {}
                processedItems++;
                _progress(`导入CG图片 ${processedItems}/${totalItems}`);
              }
              await this.updateCgGroup(cg.group, { count, imageUrls: urls });
            }
            result.imported++;
          }
        } catch (err) { result.errors.push(`CG:${cg.group}: ${err.message}`); }
      }
    }

    _progress('导入完成');
    return result;
  }

  async _importCgData(data, charId) {
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const result = { imported: 0, skipped: 0, errors: [] };
    const compOpts = await getCompressOptions(this);
    if (Array.isArray(data.groups)) {
      for (const cg of data.groups) {
        try {
          if (cg.group) {
            await this.addCgGroup(cg.group, cg.albumUrl || '', safeCharId);
            if (cg.albumUrl && cg.albumUrl.trim()) {
              try { await ensureCgGroupIndex(this, cg.group); } catch (_) {}
            }
            if (Array.isArray(cg.localImages)) {
              const groupInfo = await this.getCgGroup(cg.group);
              let urls = groupInfo ? (groupInfo.imageUrls || []) : [];
              let count = groupInfo ? (groupInfo.count || urls.length) : 0;
              for (const img of cg.localImages) {
                if (!img.imageBase64) continue;
                try {
                  let blob = this._base64ToBlob(img.imageBase64, img.mimeType);
                  blob = await compressImage(blob, compOpts);
                  const idx = img.index || (count + 1);
                  await this.putCgImage(cg.group, idx, blob, 'local://' + (img.fileName || idx));
                  while (urls.length < idx) urls.push('');
                  urls[idx - 1] = 'local://' + (img.fileName || idx);
                  if (idx > count) count = idx;
                } catch (_) {}
              }
              await this.updateCgGroup(cg.group, { count, imageUrls: urls });
            }
            result.imported++;
          } else { result.skipped++; }
        } catch (err) { result.errors.push(`CG:${cg.group}: ${err.message}`); }
      }
    }
    return result;
  }

  // -------------------- Live2D IndexedDB 写入端 --------------------

  async importLive2DFromFileList(files, onProgress, charId = null) {
    const list = Array.from(files || []).filter(file => file && file.name && !file.name.endsWith('/'));
    if (!list.length) throw new Error('没有选择任何 Live2D 文件');
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};
    const safeCharId = charId != null ? String(charId || GLOBAL_CHAR_ID) : '';
    const packages = this._buildLive2DPackagesFromFiles(list);
    const result = { imported: 0, skipped: 0, errors: [], manifests: [], adjutant: null };
    const preparedPackages = [];
    let index = 0;
    for (const input of packages) {
      index++;
      try {
        _progress(`准备 Live2D ${index}/${packages.length}: ${input.dir}`);
        const prepared = await this._prepareLive2DPackage(input);
        if (!prepared.ok) throw new Error(`${prepared.error.code}: ${prepared.error.message}`);
        preparedPackages.push(prepared.value);
      } catch (err) {
        result.errors.push(`${input.dir || '未知模型'}: ${err.message}`);
      }
    }
    if (preparedPackages.length) {
      _progress(`写入 Live2D 资源: ${preparedPackages.length} 个模型`);
      const live2dDb = await this._openLive2DDB();
      await this._putPreparedLive2DPackages(live2dDb, preparedPackages);
      for (const prepared of preparedPackages) {
        result.imported++;
        result.manifests.push(prepared.manifest);
        result.adjutant = prepared.adjutant;
        if (!safeCharId) { try { localStorage.setItem('gfl-adjutant', JSON.stringify(prepared.adjutant)); } catch (_) {} }
      }
    }
    if (safeCharId && result.manifests.length) {
      await this.bindLive2DModelsToCharacter(safeCharId, result.manifests, { active: true });
    }
    _progress('Live2D 导入完成');
    if (!result.imported && result.errors.length) throw new Error(result.errors.join('\n'));
    return result;
  }

  async importLive2DFromZip(file, onProgress, charId = null) {
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};
    _progress('正在解压 Live2D ZIP...');
    const zipBuffer = await file.arrayBuffer();
    const entries = await zipExtractAsync(zipBuffer);
    const manifestBytes = entries.get('manifest.json');
    if (manifestBytes) {
      try {
        const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
        if (manifest?.format === 'gfl-live2d-indexeddb-package' && Array.isArray(manifest.models)) {
          return this._importLive2DIndexedDBZip(entries, manifest, onProgress, charId);
        }
      } catch (_) {}
    }
    const files = [];
    for (const [path, data] of entries.entries()) {
      if (!path || path.endsWith('/') || path === 'manifest.json') continue;
      const normalizedPath = this._normalizeLive2DPath(path.replace(/^assets\//, ''));
      const name = normalizedPath.split('/').pop() || normalizedPath;
      const blob = new Blob([data], { type: this._inferLive2DMime(name) });
      Object.defineProperty(blob, 'name', { value: name });
      Object.defineProperty(blob, 'webkitRelativePath', { value: normalizedPath });
      files.push(blob);
    }
    const result = await this.importLive2DFromFileList(files, onProgress, charId);
    return result;
  }

  async _importLive2DIndexedDBZip(entries, manifest, onProgress, charId = null) {
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};
    const safeCharId = charId != null ? String(charId || GLOBAL_CHAR_ID) : '';
    const result = { imported: 0, skipped: 0, errors: [], manifests: [], adjutant: null };
    const models = manifest.models || [];
    const preparedPackages = [];
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        _progress(`准备恢复 Live2D ${i + 1}/${models.length}: ${model.dir || '未知模型'}`);
        const input = this._buildLive2DInputFromManifestZip(entries, model);
        const prepared = await this._prepareLive2DPackage(input);
        if (!prepared.ok) throw new Error(`${prepared.error.code}: ${prepared.error.message}`);
        preparedPackages.push(prepared.value);
      } catch (err) {
        result.errors.push(`${model?.dir || '未知模型'}: ${err.message}`);
      }
    }
    if (preparedPackages.length) {
      _progress(`写入 Live2D 资源: ${preparedPackages.length} 个模型`);
      const live2dDb = await this._openLive2DDB();
      await this._putPreparedLive2DPackages(live2dDb, preparedPackages);
      for (const prepared of preparedPackages) {
        result.imported++;
        result.manifests.push(prepared.manifest);
        result.adjutant = prepared.adjutant;
        if (!safeCharId) { try { localStorage.setItem('gfl-adjutant', JSON.stringify(prepared.adjutant)); } catch (_) {} }
      }
    }
    if (safeCharId && result.manifests.length) {
      await this.bindLive2DModelsToCharacter(safeCharId, result.manifests, { active: true });
    }
    _progress('Live2D 压缩包导入完成');
    if (!result.imported && result.errors.length) throw new Error(result.errors.join('\n'));
    return result;
  }

  _buildLive2DInputFromManifestZip(entries, model) {
    const dir = this._sanitizeLive2DDir(model?.dir);
    if (!dir) throw new Error('压缩包 manifest 缺少合法模型 dir');
    const states = { normal: { files: {} } };
    const destroyFiles = {};
    const assets = Array.isArray(model.assets) ? model.assets : [];
    for (const asset of assets) {
      const key = this._normalizeLive2DPath(asset.key || '');
      const parts = key.split('/');
      if (parts.length < 3 || parts[0] !== dir) continue;
      const state = parts[1];
      const relativePath = this._normalizeLive2DPath(parts.slice(2).join('/'));
      const entryPath = this._normalizeLive2DPath(asset.zipPath || `assets/${key}`);
      const data = entries.get(entryPath) || entries.get(key);
      if (!data || !relativePath) continue;
      const blob = new Blob([data], { type: asset.mime || this._inferLive2DMime(relativePath) });
      if (state === 'normal') states.normal.files[relativePath] = blob;
      else if (state === 'destroy') destroyFiles[relativePath] = blob;
    }
    if (Object.keys(destroyFiles).length) states.destroy = { files: destroyFiles };
    return { dir, name: model.name || dir, states, options: { overwrite: true, writeMeta: true, validateStrict: true } };
  }

  async listLive2DModels() {
    const db = await this._openLive2DDB();
    const records = await this._getAllLive2DRecords(db);
    return this._buildLive2DModelListFromRecords(records);
  }

  async listLive2DModelsByDirs(dirs) {
    const safeDirs = [...new Set(Array.from(dirs || []).map(dir => this._sanitizeLive2DDir(dir)).filter(Boolean))];
    if (!safeDirs.length) return [];
    const db = await this._openLive2DDB();
    const recordResults = await Promise.all(safeDirs.map(async dir => {
      try {
        return { dir, records: await this._getLive2DRecordsByDir(db, dir), error: null };
      } catch (err) {
        return { dir, records: [], error: err };
      }
    }));
    const records = recordResults.flatMap(item => item.records);
    const failedDirs = recordResults.filter(item => item.error).map(item => item.dir);
    const readErrors = recordResults.filter(item => item.error).map(item => `${item.dir}: ${item.error.message}`);
    const models = this._buildLive2DModelListFromRecords(records);
    Object.defineProperty(models, 'readErrors', { value: readErrors, enumerable: false });
    Object.defineProperty(models, 'readErrorDirs', { value: failedDirs, enumerable: false });
    return models;
  }

  async getLive2DModelPackage(dir) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) throw new Error('请选择要读取的 Live2D 模型');
    const db = await this._openLive2DDB();
    const records = await this._getLive2DRecordsByDir(db, safeDir);
    const assetRecords = records.filter(record => record.key.startsWith(`${safeDir}/`));
    if (!assetRecords.length) throw new Error(`未找到模型 ${safeDir} 的资源`);

    const result = {
      dir: safeDir,
      version: '',
      hasDestroy: false,
      jsonPath: `indexeddb://${safeDir}/normal/model.json`,
      states: {},
      assets: []
    };

    for (const record of records) {
      if (record.key === `${LIVE2D_META_PREFIX}/${safeDir}/version`) {
        result.version = String(record.value || '');
        break;
      }
    }

    for (const record of assetRecords) {
      const parts = record.key.split('/');
      const state = parts[1];
      const relativePath = parts.slice(2).join('/');
      if ((state !== 'normal' && state !== 'destroy') || !relativePath) continue;
      const blob = record.value instanceof Blob ? record.value : new Blob([record.value], { type: record.mime || this._inferLive2DMime(relativePath) });
      const asset = {
        key: record.key,
        state,
        relativePath,
        mime: blob.type || this._inferLive2DMime(relativePath),
        size: blob.size,
        kind: this._inferLive2DKindFromPath(relativePath),
        blob
      };
      if (!result.states[state]) result.states[state] = { state, files: {}, assets: [], modelJson: null };
      result.states[state].files[relativePath] = blob;
      result.states[state].assets.push(asset);
      result.assets.push(asset);
      if (state === 'destroy') result.hasDestroy = true;
    }

    for (const stateData of Object.values(result.states)) {
      const modelJsonBlob = stateData.files['model.json'];
      if (!modelJsonBlob) continue;
      try {
        stateData.modelJson = JSON.parse(await modelJsonBlob.text());
      } catch (err) {
        stateData.modelJsonError = err.message || 'model.json 解析失败';
      }
    }

    return result;
  }

  _buildLive2DModelListFromRecords(records) {
    const modelMap = new Map();
    for (const record of records) {
      if (record.key.startsWith(`${LIVE2D_META_PREFIX}/`)) continue;
      const parts = record.key.split('/');
      if (parts.length < 3) continue;
      const dir = parts[0];
      const state = parts[1];
      const relativePath = parts.slice(2).join('/');
      if (state !== 'normal' && state !== 'destroy') continue;
      if (!modelMap.has(dir)) {
        modelMap.set(dir, { dir, version: '', hasDestroy: false, states: {}, files: [], totalSize: 0 });
      }
      const model = modelMap.get(dir);
      if (state === 'destroy') model.hasDestroy = true;
      if (!model.states[state]) model.states[state] = { count: 0, size: 0 };
      model.states[state].count++;
      model.states[state].size += record.size;
      model.files.push({ key: record.key, state, relativePath, size: record.size, mime: record.mime, kind: this._inferLive2DKindFromPath(relativePath) });
      model.totalSize += record.size;
    }
    for (const record of records) {
      const match = record.key.match(/^meta\/([^/]+)\/version$/);
      if (match && modelMap.has(match[1])) modelMap.get(match[1]).version = String(record.value || '');
    }
    return Array.from(modelMap.values()).sort((a, b) => a.dir.localeCompare(b.dir)).map(model => ({
      ...model,
      files: model.files.sort((a, b) => a.key.localeCompare(b.key))
    }));
  }

  async exportLive2DModelToFile(dir, onProgress) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) throw new Error('请选择要导出的 Live2D 模型');
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};
    _progress('读取 Live2D 文件...');
    const db = await this._openLive2DDB();
    const records = await this._getAllLive2DRecords(db);
    const modelRecords = records.filter(record => record.key.startsWith(`${safeDir}/`));
    if (!modelRecords.length) throw new Error(`未找到模型 ${safeDir} 的资源`);
    const versionRecord = records.find(record => record.key === `${LIVE2D_META_PREFIX}/${safeDir}/version`);
    const zipFiles = [];
    const assets = [];
    for (const record of modelRecords) {
      const blob = record.value instanceof Blob ? record.value : new Blob([record.value], { type: record.mime || 'application/octet-stream' });
      const data = new Uint8Array(await blob.arrayBuffer());
      const zipPath = `assets/${record.key}`;
      zipFiles.push({ name: zipPath, data });
      const parts = record.key.split('/');
      const state = parts[1];
      const relativePath = parts.slice(2).join('/');
      assets.push({ key: record.key, zipPath, state, relativePath, mime: blob.type || this._inferLive2DMime(relativePath), size: blob.size, kind: this._inferLive2DKindFromPath(relativePath) });
    }
    const manifest = {
      format: 'gfl-live2d-indexeddb-package',
      version: 1,
      exportedAt: new Date().toISOString(),
      databaseName: LIVE2D_DB_NAME,
      storeName: LIVE2D_STORE_NAME,
      models: [{
        dir: safeDir,
        version: String(versionRecord?.value || ''),
        hasDestroy: assets.some(asset => asset.state === 'destroy'),
        assetCount: assets.length,
        totalSize: assets.reduce((sum, asset) => sum + asset.size, 0),
        assets
      }]
    };
    zipFiles.unshift({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    _progress('生成 Live2D 压缩包...');
    const zipBlob = zipCreate(zipFiles);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    this._downloadZipFile(zipBlob, `live2d-${safeDir}-${date}.zip`);
    return manifest.models[0];
  }

  async exportAllLive2DModelsToFile(charId, onProgress) {
    const _progress = typeof onProgress === 'function' ? onProgress : () => {};
    const safeCharId = String(charId || GLOBAL_CHAR_ID);
    const charLabel = safeCharId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    _progress(`正在读取 ${charLabel} 的 Live2D 绑定...`);
    const config = await this.getLive2DCharacterConfig(safeCharId);
    const boundDirs = Object.keys(config.models || {});
    if (!boundDirs.length) throw new Error(`${charLabel} 没有绑定的 Live2D 模型`);
    const models = await this.listLive2DModelsByDirs(boundDirs);
    const missingDirs = boundDirs.filter(dir => !models.some(m => m.dir === dir));
    if (missingDirs.length) {
      throw new Error(`以下模型资源缺失: ${missingDirs.join(', ')}`);
    }
    const zipFiles = [];
    const allManifests = [];
    let db = null;
    for (const model of models) {
      _progress(`正在打包 ${model.dir}...`);
      if (!db) db = await this._openLive2DDB();
      const modelRecords = await this._getLive2DRecordsByDir(db, model.dir);
      const version = model.version || '';
      const assets = [];
      for (const record of modelRecords) {
        if (record.key.startsWith(`${LIVE2D_META_PREFIX}/`)) continue;
        const parts = record.key.split('/');
        const state = parts[1];
        const relativePath = this._normalizeLive2DPath(parts.slice(2).join('/'));
        if ((state !== 'normal' && state !== 'destroy') || !relativePath) continue;
        const blob = record.value instanceof Blob ? record.value : new Blob([record.value], { type: record.mime || 'application/octet-stream' });
        const data = new Uint8Array(await blob.arrayBuffer());
        const zipPath = `assets/${record.key}`;
        zipFiles.push({ name: zipPath, data });
        assets.push({ key: record.key, zipPath, state, relativePath, size: blob.size, mime: blob.type || this._inferLive2DMime(relativePath), kind: this._inferLive2DKindFromPath(relativePath) });
      }
      allManifests.push({
        dir: model.dir,
        name: model.name || model.dir,
        version,
        hasDestroy: assets.some(a => a.state === 'destroy'),
        assetCount: assets.length,
        totalSize: assets.reduce((sum, a) => sum + a.size, 0),
        assets
      });
    }
    const masterManifest = {
      format: 'gfl-live2d-indexeddb-package',
      version: 1,
      exportedAt: new Date().toISOString(),
      databaseName: LIVE2D_DB_NAME,
      storeName: LIVE2D_STORE_NAME,
      models: allManifests
    };
    zipFiles.unshift({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(masterManifest, null, 2)) });
    _progress('生成 Live2D 压缩包...');
    const zipBlob = zipCreate(zipFiles);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const charName = safeCharId === GLOBAL_CHAR_ID ? 'global' : (this._charName || safeCharId);
    this._downloadZipFile(zipBlob, `live2d-${charName}-${date}.zip`);
    return allManifests;
  }

  async deleteLive2DModel(dir) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) throw new Error('请选择要删除的 Live2D 模型');
    const db = await this._openLive2DDB();
    const records = await this._getAllLive2DRecords(db);
    const keys = records.map(record => record.key).filter(key => key.startsWith(`${safeDir}/`) || key === `${LIVE2D_META_PREFIX}/${safeDir}/version`);
    if (!keys.length) return 0;
    await this._deleteLive2DKeys(db, keys);
    return keys.length;
  }

  async getLive2DCharacterConfig(charId) {
    const raw = await this.getConfig(buildLive2DConfigKey(charId), null);
    if (!raw) return { models: {}, activeDir: '' };
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const models = parsed && typeof parsed.models === 'object' && parsed.models ? parsed.models : {};
      const activeDir = typeof parsed?.activeDir === 'string' ? parsed.activeDir : '';
      return { models, activeDir };
    } catch (_) {
      return { models: {}, activeDir: '' };
    }
  }

  async setLive2DCharacterConfig(charId, config) {
    const models = config && typeof config.models === 'object' && config.models ? config.models : {};
    const activeDir = typeof config?.activeDir === 'string' ? config.activeDir : '';
    return this.setConfig(buildLive2DConfigKey(charId), JSON.stringify({ models, activeDir }));
  }

  async bindLive2DModelToCharacter(charId, manifest, { active = true } = {}) {
    return this.bindLive2DModelsToCharacter(charId, [manifest], { active });
  }

  async bindLive2DModelsToCharacter(charId, manifests, { active = true } = {}) {
    const validManifests = Array.from(manifests || []).filter(manifest => manifest?.dir);
    if (!validManifests.length) throw new Error('Live2D manifest 缺少模型 dir');
    const config = await this.getLive2DCharacterConfig(charId);
    const now = Date.now();
    for (const manifest of validManifests) {
      const existing = config.models[manifest.dir] || {};
      config.models[manifest.dir] = {
        ...existing,
        dir: manifest.dir,
        name: manifest.name || existing.name || manifest.dir,
        version: manifest.version || existing.version || '',
        hasDestroy: !!manifest.states?.destroy,
        importedAt: existing.importedAt || now,
        updatedAt: now
      };
    }
    if (active) config.activeDir = validManifests[validManifests.length - 1].dir;
    await this.setLive2DCharacterConfig(charId, config);
    return config;
  }

  async setLive2DActiveForCharacter(charId, dir) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) throw new Error('请选择要启用的 Live2D 模型');
    const config = await this.getLive2DCharacterConfig(charId);
    if (!config.models[safeDir]) {
      config.models[safeDir] = { dir: safeDir, name: safeDir, version: '', hasDestroy: false, importedAt: Date.now(), updatedAt: Date.now() };
    }
    config.activeDir = safeDir;
    config.models[safeDir].updatedAt = Date.now();
    await this.setLive2DCharacterConfig(charId, config);
    return config;
  }

  async unbindLive2DModelFromCharacter(charId, dir) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) throw new Error('请选择要移除的 Live2D 模型');
    const config = await this.getLive2DCharacterConfig(charId);
    if (!config.models[safeDir]) return false;
    delete config.models[safeDir];
    if (config.activeDir === safeDir) {
      config.activeDir = Object.keys(config.models)[0] || '';
    }
    await this.setLive2DCharacterConfig(charId, config);
    return true;
  }

  async clearLive2DCharacterBindings(charId) {
    const config = await this.getLive2DCharacterConfig(charId);
    const count = Object.keys(config.models || {}).length;
    await this.setLive2DCharacterConfig(charId, { models: {}, activeDir: '' });
    return count;
  }

  async _getAllLive2DRecords(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LIVE2D_STORE_NAME, 'readonly');
      const store = tx.objectStore(LIVE2D_STORE_NAME);
      const req = store.openCursor();
      const records = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value = cursor.value;
        const size = value instanceof Blob ? value.size : (typeof value === 'string' ? value.length : (value?.byteLength || 0));
        const mime = value instanceof Blob ? value.type : 'text/plain';
        records.push({ key: String(cursor.key), value, size, mime });
        cursor.continue();
      };
      tx.oncomplete = () => resolve(records);
      tx.onerror = () => reject(new Error(`Live2D 列表读取失败: ${tx.error?.message || tx.error}`));
    });
  }

  async _getLive2DRecordsByDir(db, dir) {
    const safeDir = this._sanitizeLive2DDir(dir);
    if (!safeDir) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LIVE2D_STORE_NAME, 'readonly');
      const store = tx.objectStore(LIVE2D_STORE_NAME);
      const records = [];
      let byteCount = 0;
      const range = IDBKeyRange.bound(`${safeDir}/`, `${safeDir}/\uffff`);
      const cursorReq = store.openCursor(range);
      const metaReq = store.get(`${LIVE2D_META_PREFIX}/${safeDir}/version`);
      const pushRecord = (key, value) => {
        const size = value instanceof Blob ? value.size : (typeof value === 'string' ? value.length : (value?.byteLength || 0));
        const mime = value instanceof Blob ? value.type : 'text/plain';
        byteCount += size || 0;
        records.push({ key: String(key), value, size, mime });
      };
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        pushRecord(cursor.key, cursor.value);
        cursor.continue();
      };
      metaReq.onsuccess = () => {
        if (metaReq.result != null) pushRecord(`${LIVE2D_META_PREFIX}/${safeDir}/version`, metaReq.result);
      };
      tx.oncomplete = () => {
        resolve(records);
      };
      tx.onerror = () => {
        reject(new Error(`Live2D 模型 ${safeDir} 读取失败: ${tx.error?.message || tx.error}`));
      };
    });
  }

  async _deleteLive2DKeys(db, keys) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LIVE2D_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LIVE2D_STORE_NAME);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`Live2D 删除失败: ${tx.error?.message || tx.error}`));
    });
  }

  _buildLive2DPackagesFromFiles(files) {
    const packageMap = new Map();
    for (const file of files) {
      const path = this._normalizeLive2DPath(file?.webkitRelativePath || file?.name || '');
      if (!path || path.endsWith('/')) continue;
      const parts = path.split('/');
      const stateIndex = parts.findIndex(part => part === 'normal' || part === 'destroy');
      if (stateIndex <= 0 || stateIndex >= parts.length - 1) continue;
      const state = parts[stateIndex];
      const dir = parts[stateIndex - 1];
      const relativePath = this._normalizeLive2DPath(parts.slice(stateIndex + 1).join('/'));
      if (!dir || !relativePath) continue;
      const packagePrefix = parts.slice(0, stateIndex).join('/');
      const packageKey = `${packagePrefix}/${dir}`;
      if (!packageMap.has(packageKey)) {
        packageMap.set(packageKey, { dir, name: dir, states: { normal: { files: {} } }, destroyFiles: {} });
      }
      const modelPackage = packageMap.get(packageKey);
      if (state === 'normal') modelPackage.states.normal.files[relativePath] = file;
      else modelPackage.destroyFiles[relativePath] = file;
    }

    const packages = [];
    for (const modelPackage of packageMap.values()) {
      if (!modelPackage.states.normal.files['model.json']) continue;
      if (Object.keys(modelPackage.destroyFiles).length) modelPackage.states.destroy = { files: modelPackage.destroyFiles };
      delete modelPackage.destroyFiles;
      packages.push({ ...modelPackage, options: { overwrite: true, writeMeta: true, validateStrict: true } });
    }
    if (!packages.length) throw new Error('未找到 normal/model.json。请选择单个模型目录，或选择 Girls-Frontline 父目录进行批量导入');
    return packages.sort((a, b) => a.dir.localeCompare(b.dir));
  }

  async writeLive2DPackage(input) {
    try {
      const prepared = await this._prepareLive2DPackage(input);
      if (!prepared.ok) return prepared;
      const live2dDb = await this._openLive2DDB();
      await this._putPreparedLive2DPackages(live2dDb, [prepared.value]);
      return { ok: true, adjutant: prepared.value.adjutant, manifest: prepared.value.manifest };
    } catch (err) {
      return this._live2DError('INDEXEDDB_WRITE_FAILED', err.message || 'Live2D 写入失败');
    }
  }

  async _prepareLive2DPackage(input) {
    if (!input || typeof input !== 'object') return this._live2DError('INVALID_INPUT', 'Live2D 输入必须是对象');
    const dir = this._sanitizeLive2DDir(input.dir);
    if (!dir) return this._live2DError('INVALID_INPUT', 'dir 不能为空，且不能包含路径分隔符');
    if (!input.states || !input.states.normal) return this._live2DError('MISSING_NORMAL_STATE', '缺少 states.normal');
    const options = { overwrite: true, writeMeta: true, validateStrict: true, ...(input.options || {}) };
    const preparedStates = {};
    const allAssets = [];

    for (const state of ['normal', 'destroy']) {
      if (!input.states[state]) continue;
      const prepared = await this._prepareLive2DState(dir, state, input.states[state], options);
      if (!prepared.ok) return prepared;
      preparedStates[state] = prepared.value;
      allAssets.push(...prepared.value.assets);
    }

    if (!preparedStates.normal) return this._live2DError('MISSING_NORMAL_STATE', '缺少 states.normal');
    const version = this._buildLive2DVersion(allAssets);
    const stateManifest = {};
    for (const [state, prepared] of Object.entries(preparedStates)) {
      const requiredAssetCount = prepared.assets.filter(asset => asset.required).length;
      stateManifest[state] = {
        state,
        modelJsonKey: `${dir}/${state}/model.json`,
        assetCount: prepared.assets.length,
        requiredAssetCount,
        optionalAssetCount: prepared.assets.length - requiredAssetCount
      };
    }
    const adjutant = {
      ...(input.name ? { name: input.name } : {}),
      live2d: {
        dir,
        jsonPath: `indexeddb://${dir}/normal/model.json`,
        version,
        hasDestroy: !!preparedStates.destroy
      }
    };
    const manifest = {
      dir,
      ...(input.name ? { name: input.name } : {}),
      version,
      databaseName: LIVE2D_DB_NAME,
      storeName: LIVE2D_STORE_NAME,
      states: stateManifest,
      assets: allAssets.map(({ blob, ...asset }) => asset)
    };
    return { ok: true, value: { dir, options, allAssets, version, adjutant, manifest } };
  }

  async _prepareLive2DState(dir, state, stateInput, options) {
    if (!stateInput || !stateInput.files || typeof stateInput.files !== 'object') {
      return this._live2DError(state === 'destroy' ? 'INCOMPLETE_DESTROY_STATE' : 'INVALID_INPUT', `${state} 状态缺少 files`);
    }
    const rawFiles = stateInput.files;
    if (!rawFiles['model.json']) return this._live2DError('MISSING_MODEL_JSON', `${state}/model.json 不存在`);
    const entries = Object.entries(rawFiles);
    let normalizedEntries;
    try {
      normalizedEntries = await Promise.all(entries.map(async ([relativePath, value]) => {
        const safePath = this._normalizeLive2DPath(relativePath);
        if (!safePath || safePath.startsWith('../') || safePath.includes('/../')) {
          throw new Error(`非法资源路径: ${relativePath}`);
        }
        return [safePath, await this._toLive2DBlob(value, safePath)];
      }));
    } catch (err) {
      return this._live2DError('INVALID_INPUT', err.message || 'Live2D 文件转换失败');
    }
    const normalizedFiles = new Map(normalizedEntries);

    let modelJson;
    try { modelJson = JSON.parse(await normalizedFiles.get('model.json').text()); }
    catch (err) { return this._live2DError('INVALID_MODEL_JSON', `${state}/model.json 解析失败: ${err.message}`); }
    const refs = this._collectLive2DReferences(modelJson);
    if (!refs.model) return this._live2DError('INVALID_MODEL_JSON', `${state}/model.json 缺少 model 字段`);
    if (!Array.isArray(refs.textures) || !refs.textures.length) return this._live2DError('INVALID_MODEL_JSON', `${state}/model.json 缺少 textures 数组`);

    const motionSet = new Set(refs.motions);
    const requiredPaths = new Set(['model.json', refs.model, ...refs.textures]);
    const declaredPaths = new Set([...requiredPaths, ...refs.motions, ...refs.expressions, ...refs.gflTouchMotions]);
    if (refs.physics) declaredPaths.add(refs.physics);
    if (refs.pose) declaredPaths.add(refs.pose);

    if (!normalizedFiles.has(refs.model)) return this._live2DError('MISSING_MODEL_MOC', `${state}/${refs.model} 不存在`);
    for (const texture of refs.textures) if (!normalizedFiles.has(texture)) return this._live2DError('MISSING_TEXTURE', `${state}/${texture} 不存在`);
    if (options.validateStrict) {
      for (const motion of refs.motions) if (!normalizedFiles.has(motion)) return this._live2DError('MISSING_MOTION', `${state}/${motion} 不存在`);
    }
    if (refs.physics && !normalizedFiles.has(refs.physics)) return this._live2DError('MISSING_PHYSICS', `${state}/${refs.physics} 不存在`);
    if (refs.pose && !normalizedFiles.has(refs.pose)) return this._live2DError('MISSING_POSE', `${state}/${refs.pose} 不存在`);
    for (const expression of refs.expressions) if (!normalizedFiles.has(expression)) return this._live2DError('MISSING_EXPRESSION', `${state}/${expression} 不存在`);
    for (const touchMotion of refs.gflTouchMotions) {
      if (!normalizedFiles.has(touchMotion)) return this._live2DError('INVALID_TOUCH_MOTION_MAP', `${state}/${touchMotion} 不存在`);
      if (!motionSet.has(touchMotion)) return this._live2DError('TOUCH_MOTION_NOT_IN_MOTIONS', `gfl_touch_motions 引用了 ${touchMotion}，但该文件没有出现在 motions 中`);
    }

    const assets = [];
    for (const [relativePath, blob] of normalizedFiles.entries()) {
      const key = `${dir}/${state}/${relativePath}`;
      const required = declaredPaths.has(relativePath);
      assets.push({
        key,
        state,
        relativePath,
        mime: blob.type || this._inferLive2DMime(relativePath),
        size: blob.size,
        required,
        kind: this._inferLive2DKind(relativePath, refs),
        blob
      });
    }
    return { ok: true, value: { modelJson, refs, assets } };
  }

  _collectLive2DReferences(modelJson) {
    const normalize = value => this._normalizeLive2DPath(value || '');
    const motions = [];
    const expressions = [];
    const gflTouchMotions = [];
    if (modelJson && typeof modelJson.motions === 'object') {
      for (const group of Object.values(modelJson.motions)) {
        if (!Array.isArray(group)) continue;
        for (const motion of group) if (motion?.file) motions.push(normalize(motion.file));
      }
    }
    if (Array.isArray(modelJson?.expressions)) {
      for (const expression of modelJson.expressions) if (expression?.file) expressions.push(normalize(expression.file));
    }
    if (modelJson && typeof modelJson.gfl_touch_motions === 'object') {
      for (const list of Object.values(modelJson.gfl_touch_motions)) {
        if (!Array.isArray(list)) continue;
        for (const file of list) if (typeof file === 'string') gflTouchMotions.push(normalize(file));
      }
    }
    return {
      model: normalize(modelJson?.model),
      textures: Array.isArray(modelJson?.textures) ? modelJson.textures.map(normalize).filter(Boolean) : [],
      motions: [...new Set(motions.filter(Boolean))],
      expressions: [...new Set(expressions.filter(Boolean))],
      physics: normalize(modelJson?.physics),
      pose: normalize(modelJson?.pose),
      gflTouchMotions: [...new Set(gflTouchMotions.filter(Boolean))]
    };
  }

  async _openLive2DDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LIVE2D_DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(LIVE2D_STORE_NAME)) db.createObjectStore(LIVE2D_STORE_NAME);
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(new Error(`Live2D IndexedDB 打开失败: ${event.target.error}`));
    });
  }

  async _putPreparedLive2DPackages(db, packages) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LIVE2D_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LIVE2D_STORE_NAME);
      let assetCount = 0;
      let metaCount = 0;
      let byteCount = 0;
      for (const modelPackage of packages) {
        for (const asset of modelPackage.allAssets) {
          assetCount++;
          byteCount += asset.size || 0;
          if (modelPackage.options.overwrite) store.put(asset.blob, asset.key);
          else store.add(asset.blob, asset.key);
        }
        if (modelPackage.options.writeMeta) {
          metaCount++;
          store.put(String(modelPackage.version), `${LIVE2D_META_PREFIX}/${modelPackage.dir}/version`);
        }
      }
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(new Error(`Live2D 资源写入失败: ${tx.error?.message || tx.error}`));
      };
    });
  }

  _buildLive2DVersion(assets) {
    const payload = assets
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(asset => `${asset.key}:${asset.size}:${asset.mime || ''}`)
      .join('\n');
    return this._md5Text(payload).slice(0, 16);
  }

  _md5Text(text) {
    const rotateLeft = (value, bits) => (value << bits) | (value >>> (32 - bits));
    const addUnsigned = (a, b) => {
      const aHigh = a & 0x80000000;
      const bHigh = b & 0x80000000;
      const aLow = a & 0x40000000;
      const bLow = b & 0x40000000;
      const result = (a & 0x3fffffff) + (b & 0x3fffffff);
      if (aLow & bLow) return result ^ 0x80000000 ^ aHigh ^ bHigh;
      if (aLow | bLow) return (result & 0x40000000) ? result ^ 0xc0000000 ^ aHigh ^ bHigh : result ^ 0x40000000 ^ aHigh ^ bHigh;
      return result ^ aHigh ^ bHigh;
    };
    const cmn = (q, a, b, x, s, t) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, q), addUnsigned(x, t)), s), b);
    const ff = (a, b, c, d, x, s, t) => cmn((b & c) | ((~b) & d), a, b, x, s, t);
    const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & (~d)), a, b, x, s, t);
    const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
    const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | (~d)), a, b, x, s, t);
    const bytes = new TextEncoder().encode(text);
    const wordCount = (((bytes.length + 8) >>> 6) + 1) * 16;
    const words = new Array(wordCount).fill(0);
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    const bitLength = bytes.length * 8;
    words[wordCount - 2] = bitLength & 0xffffffff;
    words[wordCount - 1] = Math.floor(bitLength / 0x100000000);

    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    for (let k = 0; k < words.length; k += 16) {
      const aa = a;
      const bb = b;
      const cc = c;
      const dd = d;
      a = ff(a, b, c, d, words[k + 0], 7, 0xd76aa478);
      d = ff(d, a, b, c, words[k + 1], 12, 0xe8c7b756);
      c = ff(c, d, a, b, words[k + 2], 17, 0x242070db);
      b = ff(b, c, d, a, words[k + 3], 22, 0xc1bdceee);
      a = ff(a, b, c, d, words[k + 4], 7, 0xf57c0faf);
      d = ff(d, a, b, c, words[k + 5], 12, 0x4787c62a);
      c = ff(c, d, a, b, words[k + 6], 17, 0xa8304613);
      b = ff(b, c, d, a, words[k + 7], 22, 0xfd469501);
      a = ff(a, b, c, d, words[k + 8], 7, 0x698098d8);
      d = ff(d, a, b, c, words[k + 9], 12, 0x8b44f7af);
      c = ff(c, d, a, b, words[k + 10], 17, 0xffff5bb1);
      b = ff(b, c, d, a, words[k + 11], 22, 0x895cd7be);
      a = ff(a, b, c, d, words[k + 12], 7, 0x6b901122);
      d = ff(d, a, b, c, words[k + 13], 12, 0xfd987193);
      c = ff(c, d, a, b, words[k + 14], 17, 0xa679438e);
      b = ff(b, c, d, a, words[k + 15], 22, 0x49b40821);
      a = gg(a, b, c, d, words[k + 1], 5, 0xf61e2562);
      d = gg(d, a, b, c, words[k + 6], 9, 0xc040b340);
      c = gg(c, d, a, b, words[k + 11], 14, 0x265e5a51);
      b = gg(b, c, d, a, words[k + 0], 20, 0xe9b6c7aa);
      a = gg(a, b, c, d, words[k + 5], 5, 0xd62f105d);
      d = gg(d, a, b, c, words[k + 10], 9, 0x02441453);
      c = gg(c, d, a, b, words[k + 15], 14, 0xd8a1e681);
      b = gg(b, c, d, a, words[k + 4], 20, 0xe7d3fbc8);
      a = gg(a, b, c, d, words[k + 9], 5, 0x21e1cde6);
      d = gg(d, a, b, c, words[k + 14], 9, 0xc33707d6);
      c = gg(c, d, a, b, words[k + 3], 14, 0xf4d50d87);
      b = gg(b, c, d, a, words[k + 8], 20, 0x455a14ed);
      a = gg(a, b, c, d, words[k + 13], 5, 0xa9e3e905);
      d = gg(d, a, b, c, words[k + 2], 9, 0xfcefa3f8);
      c = gg(c, d, a, b, words[k + 7], 14, 0x676f02d9);
      b = gg(b, c, d, a, words[k + 12], 20, 0x8d2a4c8a);
      a = hh(a, b, c, d, words[k + 5], 4, 0xfffa3942);
      d = hh(d, a, b, c, words[k + 8], 11, 0x8771f681);
      c = hh(c, d, a, b, words[k + 11], 16, 0x6d9d6122);
      b = hh(b, c, d, a, words[k + 14], 23, 0xfde5380c);
      a = hh(a, b, c, d, words[k + 1], 4, 0xa4beea44);
      d = hh(d, a, b, c, words[k + 4], 11, 0x4bdecfa9);
      c = hh(c, d, a, b, words[k + 7], 16, 0xf6bb4b60);
      b = hh(b, c, d, a, words[k + 10], 23, 0xbebfbc70);
      a = hh(a, b, c, d, words[k + 13], 4, 0x289b7ec6);
      d = hh(d, a, b, c, words[k + 0], 11, 0xeaa127fa);
      c = hh(c, d, a, b, words[k + 3], 16, 0xd4ef3085);
      b = hh(b, c, d, a, words[k + 6], 23, 0x04881d05);
      a = hh(a, b, c, d, words[k + 9], 4, 0xd9d4d039);
      d = hh(d, a, b, c, words[k + 12], 11, 0xe6db99e5);
      c = hh(c, d, a, b, words[k + 15], 16, 0x1fa27cf8);
      b = hh(b, c, d, a, words[k + 2], 23, 0xc4ac5665);
      a = ii(a, b, c, d, words[k + 0], 6, 0xf4292244);
      d = ii(d, a, b, c, words[k + 7], 10, 0x432aff97);
      c = ii(c, d, a, b, words[k + 14], 15, 0xab9423a7);
      b = ii(b, c, d, a, words[k + 5], 21, 0xfc93a039);
      a = ii(a, b, c, d, words[k + 12], 6, 0x655b59c3);
      d = ii(d, a, b, c, words[k + 3], 10, 0x8f0ccc92);
      c = ii(c, d, a, b, words[k + 10], 15, 0xffeff47d);
      b = ii(b, c, d, a, words[k + 1], 21, 0x85845dd1);
      a = ii(a, b, c, d, words[k + 8], 6, 0x6fa87e4f);
      d = ii(d, a, b, c, words[k + 15], 10, 0xfe2ce6e0);
      c = ii(c, d, a, b, words[k + 6], 15, 0xa3014314);
      b = ii(b, c, d, a, words[k + 13], 21, 0x4e0811a1);
      a = ii(a, b, c, d, words[k + 4], 6, 0xf7537e82);
      d = ii(d, a, b, c, words[k + 11], 10, 0xbd3af235);
      c = ii(c, d, a, b, words[k + 2], 15, 0x2ad7d2bb);
      b = ii(b, c, d, a, words[k + 9], 21, 0xeb86d391);
      a = addUnsigned(a, aa);
      b = addUnsigned(b, bb);
      c = addUnsigned(c, cc);
      d = addUnsigned(d, dd);
    }

    const toHex = value => {
      let result = '';
      for (let i = 0; i < 4; i++) result += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return result;
    };
    return `${toHex(a)}${toHex(b)}${toHex(c)}${toHex(d)}`;
  }

  async _toLive2DBlob(value, relativePath) {
    const mime = this._inferLive2DMime(relativePath);
    const isBlobLike = (input) => {
      if (!input || typeof input !== 'object') return false;
      if (input instanceof Blob) return true;
      const tag = Object.prototype.toString.call(input);
      return (tag === '[object Blob]' || tag === '[object File]') && typeof input.size === 'number' && typeof input.slice === 'function';
    };
    const makeBlob = async (input, fallbackMime = mime) => {
      if (input == null) throw new Error(`Live2D 文件为空: ${relativePath}`);
      const inputMime = input?.type || fallbackMime;
      if (isBlobLike(input)) return input;
      if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return new Blob([input], { type: inputMime || fallbackMime });
      if (typeof input === 'string') return new Blob([input], { type: inputMime || fallbackMime });
      throw new Error(`无法转换 Live2D 文件: ${relativePath}`);
    };

    if (value && typeof value === 'object' && 'data' in value) {
      return makeBlob(value.data, value.mime || mime);
    }
    return makeBlob(value, mime);
  }

  _normalizeLive2DPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(part => part && part !== '.').join('/');
  }

  _sanitizeLive2DDir(dir) {
    const value = String(dir || '').trim();
    if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') return '';
    return value;
  }

  _inferLive2DMime(relativePath) {
    const lower = String(relativePath || '').toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.exp')) return 'application/json';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }

  _inferLive2DKind(relativePath, refs) {
    if (relativePath === 'model.json') return 'model-json';
    if (relativePath === refs.model || relativePath.endsWith('.moc')) return 'moc';
    if (refs.textures.includes(relativePath) || /\.(png|jpe?g|webp)$/i.test(relativePath)) return 'texture';
    if (refs.motions.includes(relativePath) || relativePath.endsWith('.mtn')) return 'motion';
    if (relativePath === refs.physics) return 'physics';
    if (relativePath === refs.pose) return 'pose';
    if (refs.expressions.includes(relativePath)) return 'expression';
    return 'other';
  }

  _inferLive2DKindFromPath(relativePath) {
    const lower = String(relativePath || '').toLowerCase();
    if (lower === 'model.json') return 'model-json';
    if (lower.endsWith('.moc')) return 'moc';
    if (/\.(png|jpe?g|webp)$/.test(lower)) return 'texture';
    if (lower.endsWith('.mtn')) return 'motion';
    if (lower.includes('physics') && lower.endsWith('.json')) return 'physics';
    if (lower.includes('pose') && lower.endsWith('.json')) return 'pose';
    if (lower.endsWith('.exp')) return 'expression';
    return 'other';
  }

  _live2DError(code, message, details) {
    return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
  }

  // -------------------- 缓存管理 --------------------

  _revokeCachedUrl(key) {
    if (this._blobUrlCache.has(key)) {
      URL.revokeObjectURL(this._blobUrlCache.get(key));
      this._blobUrlCache.delete(key);
    }
  }

  revokeAllUrls() {
    for (const url of this._blobUrlCache.values()) URL.revokeObjectURL(url);
    this._blobUrlCache.clear();
  }

  async clearAll() {
    await this._ensureDB();
    this.revokeAllUrls();
    const stores = [STORE_AVATARS, STORE_CONFIG, STORE_MOOD_AVATARS];
    if (this.db.objectStoreNames.contains(STORE_LOCAL_FONTS)) stores.push(STORE_LOCAL_FONTS);
    const tx = this.db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        clearStyleSnapshot();
        resolve();
      };
      tx.onerror = () => reject(new Error(`清空失败`));
    });
  }

  // -------------------- 内部工具 --------------------

  _put(storeName, record) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(storeName, 'readwrite').objectStore(storeName).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`写入失败`));
    });
  }

  _getByKey(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(new Error(`读取失败`));
    });
  }

  _deleteByKey(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`删除失败`));
    });
  }

  _blobToBase64(blob) {
    if (!blob) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Blob 转 Base64 失败'));
      reader.readAsDataURL(blob);
    });
  }

  _base64ToBlob(base64, mimeType = 'image/jpeg') {
    const byteChars = atob(base64);
    const chunks = [];
    for (let i = 0; i < byteChars.length; i += 512) {
      const slice = byteChars.slice(i, i + 512);
      const bytes = new Uint8Array(slice.length);
      for (let j = 0; j < slice.length; j++) bytes[j] = slice.charCodeAt(j);
      chunks.push(bytes);
    }
    return new Blob(chunks, { type: mimeType });
  }
}

// ████████████████████████████████████████████████████████████
// █                                                        █
// █  Part 2: 对话气泡面板 UI（头像管理 + 正文美化）          █
// █                                                        █
// ████████████████████████████████████████████████████████████

class AvatarManagerPanel {
  constructor(db) {
    this.db = db;
    this.pendingFile = null;
    this.isOpen = false;
    this._mainWindow = null;
    this._syncOverlayLayoutBound = null;
    this._livePreviewTimer = null;
    this._styleDraftLoaded = false;
    this._styleDraftDirty = false;
    this._pendingBubbleRefresh = false;
    this._pendingBubbleRefreshDelay = 0;
    this._panelOffset = { x: 0, y: 0 };
    this._panelDragState = null;
    this._panelDragBindings = null;
    this.currentTab = 'avatar';
    this._charId = '';
    this._charName = '';
    this._expandedMoodName = null;
    this._moodConfigLoaded = false;
    this._moodConfigDirty = false;
    this._moodConfigDraft = null;
    this._formatRuleDraft = null;
  }

  /**
   * 判断当前是否为移动端（触屏 + 窄屏）
   */
  _isMobile() {
    try {
      const w = this._mainWindow || this._getMainWindow();
      return ('ontouchstart' in w) && (w.innerWidth <= 768);
    } catch { return false; }
  }

  _normalizeHexColor(value, fallback = '#58a6ff') {
    if (typeof value !== 'string') return fallback;
    let hex = value.trim();
    if (!hex) return fallback;
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    return fallback;
  }

  _hexToRgb(hex) {
    const normalized = this._normalizeHexColor(hex, '#58a6ff');
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16)
    };
  }

  _rgbToHex(r, g, b) {
    const clamp = (value) => Math.min(255, Math.max(0, Number.parseInt(value, 10) || 0));
    return `#${[clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  _openImagePreview(src, title = '') {
    const doc = this._getMainDocument();
    doc.getElementById('bam-image-preview')?.remove();
    const overlay = doc.createElement('div');
    overlay.id = 'bam-image-preview';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer;';
    overlay.innerHTML = `
      <div style="color:#999;font-size:12px;margin-bottom:8px;">${escapeHtmlAttr(title)}<span style="margin-left:12px;color:#666;">点击任意处关闭</span></div>
      <img src="${src}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);" />
    `;
    overlay.addEventListener('click', () => overlay.remove());
    doc.body.appendChild(overlay);
  }

  _showTextareaDialog({ title = '', placeholder = '', onConfirm } = {}) {
    const doc = this._getMainDocument();
    const mainWindow = this._mainWindow || this._getMainWindow();
    doc.getElementById('bam-textarea-dialog')?.remove();
    const overlay = doc.createElement('div');
    overlay.id = 'bam-textarea-dialog';
    overlay.innerHTML = `
      <div class="bam-ta-backdrop" style="position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,0.7);"></div>
      <div class="bam-ta-shell" style="position:fixed;inset:0;z-index:100011;pointer-events:none;">
        <div class="bam-ta-card" style="position:absolute;left:50%;top:30%;transform:translate(-50%,0);width:min(480px,92vw);max-height:70vh;background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.5);display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;">
          <div class="bam-ta-drag" style="display:flex;align-items:center;justify-content:center;padding:10px 16px 6px;cursor:grab;touch-action:none;">
            <div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.15);"></div>
          </div>
          <div style="padding:0 16px 8px;">
            <div style="color:#ccc;font-size:13px;font-weight:600;">${escapeHtmlAttr(title)}</div>
          </div>
          <div style="padding:0 16px;flex:1;overflow:auto;">
            <textarea id="bam-textarea-input" placeholder="${escapeHtmlAttr(placeholder)}" style="width:100%;min-height:120px;max-height:40vh;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#ddd;font-size:12px;font-family:monospace;padding:10px;resize:vertical;box-sizing:border-box;"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;">
            <button id="bam-textarea-cancel" style="background:rgba(255,255,255,0.06);border:none;color:#888;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:12px;">取消</button>
            <button id="bam-textarea-ok" style="background:rgba(74,108,247,0.2);border:1px solid rgba(74,108,247,0.3);color:#b9c7ff;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:12px;">确定</button>
          </div>
          <div class="bam-ta-drag" style="display:flex;align-items:center;justify-content:center;padding:6px 16px 10px;cursor:grab;touch-action:none;">
            <div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.15);"></div>
          </div>
        </div>
      </div>
    `;
    doc.body.appendChild(overlay);

    const card = overlay.querySelector('.bam-ta-card');
    const textarea = doc.getElementById('bam-textarea-input');
    textarea.focus();

    // 拖动逻辑（顶部+底部拖动条都能拖）
    let dragState = null;
    overlay.querySelectorAll('.bam-ta-drag').forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const rect = card.getBoundingClientRect();
        dragState = { startX: e.clientX, startY: e.clientY, startLeft: rect.left + rect.width / 2, startTop: rect.top, pointerId: e.pointerId };
        handle.style.cursor = 'grabbing';
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        card.style.left = (dragState.startLeft + dx) + 'px';
        card.style.top = (dragState.startTop + dy) + 'px';
        card.style.transform = 'translate(-50%,0)';
      });
      const endDrag = (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        dragState = null;
        handle.style.cursor = 'grab';
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    });

    // 点背景关闭
    overlay.querySelector('.bam-ta-backdrop').addEventListener('click', () => overlay.remove());
    doc.getElementById('bam-textarea-cancel').addEventListener('click', () => overlay.remove());
    doc.getElementById('bam-textarea-ok').addEventListener('click', () => {
      const value = textarea.value;
      overlay.remove();
      if (onConfirm) onConfirm(value);
    });
  }

  _openMobileColorDialog({ title = '选择颜色', initialValue = '#58a6ff', onConfirm } = {}) {
    const doc = this._getMainDocument();
    const mainWindow = this._mainWindow || this._getMainWindow();
    doc.getElementById('bam-mobile-color-dialog')?.remove();

    const presetColors = ['#f47b67', '#45ddc0', '#e78bff', '#f0b232', '#58a6ff', '#ff9a76', '#7ee787', '#d2a8ff'];
    const current = this._hexToRgb(initialValue);
    const overlay = doc.createElement('div');
    overlay.id = 'bam-mobile-color-dialog';
    overlay.innerHTML = `
      <div class="bam-mobile-color-backdrop" style="position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.72);"></div>
      <div class="bam-mobile-color-shell" style="position:fixed; inset:0; z-index:100002; box-sizing:border-box; pointer-events:none;">
        <div class="bam-mobile-color-card" style="position:absolute; width:min(360px, calc(100vw - 28px)); max-height:calc(100vh - 96px); background:#1a1a2e; border:1px solid rgba(255,255,255,0.08); border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,0.45); overflow:hidden; display:flex; flex-direction:column; pointer-events:auto; transition:left 0.12s ease-out, top 0.12s ease-out;">
          <div class="bam-mobile-color-drag-handle" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:grab; touch-action:none;">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="display:inline-flex; flex-direction:column; gap:3px; opacity:0.45; flex:0 0 auto;">
                <span style="display:block; width:14px; height:2px; border-radius:999px; background:rgba(255,255,255,0.55);"></span>
                <span style="display:block; width:14px; height:2px; border-radius:999px; background:rgba(255,255,255,0.55);"></span>
              </span>
              <div style="min-width:0;">
                <div style="color:#e8e8ee; font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtmlAttr(title)}</div>
                <div style="color:#7d7d93; font-size:11px; margin-top:3px;">顶部和底部都可以拖动</div>
              </div>
            </div>
            <button type="button" class="bam-mobile-color-cancel" style="background:none; border:none; color:#888; font-size:22px; line-height:1; padding:0 4px; flex:0 0 auto;">&times;</button>
          </div>
          <div class="bam-mobile-color-body" style="padding:16px 18px 18px; overflow:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;">
            <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px;">
              <div class="bam-mobile-color-preview" style="width:56px; height:56px; border-radius:16px; background:${this._rgbToHex(current.r, current.g, current.b)}; border:1px solid rgba(255,255,255,0.12); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);"></div>
              <div style="flex:1; min-width:0;">
                <div style="color:#8b8ba3; font-size:11px; margin-bottom:6px; letter-spacing:0.4px; text-transform:uppercase;">HEX</div>
                <input class="bam-mobile-color-hex" type="text" value="${this._rgbToHex(current.r, current.g, current.b)}" maxlength="7" style="width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:10px 12px; color:#f3f3f7; font-size:15px; box-sizing:border-box; outline:none;" />
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
              ${presetColors.map(color => `<button type="button" class="bam-mobile-color-preset" data-color="${color}" style="width:28px; height:28px; border-radius:50%; border:2px solid rgba(255,255,255,0.14); background:${color}; padding:0;"></button>`).join('')}
            </div>
            ${[
              { key: 'r', label: 'R', color: '#ef4444', value: current.r },
              { key: 'g', label: 'G', color: '#22c55e', value: current.g },
              { key: 'b', label: 'B', color: '#3b82f6', value: current.b }
            ].map(channel => `
              <div style="margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span style="color:#d0d0d8; font-size:13px; font-weight:600;">${channel.label}</span>
                  <span class="bam-mobile-color-value" data-channel="${channel.key}" style="color:#888; font-size:12px;">${channel.value}</span>
                </div>
                <input class="bam-mobile-color-range" data-channel="${channel.key}" type="range" min="0" max="255" step="1" value="${channel.value}" style="width:100%; accent-color:${channel.color};" />
              </div>
            `).join('')}
            <div style="display:flex; gap:10px; margin-top:18px;">
              <button type="button" class="bam-mobile-color-cancel" style="flex:1; background:rgba(255,255,255,0.06); border:none; color:#c5c5cf; padding:12px 14px; border-radius:10px; font-size:14px;">取消</button>
              <button type="button" class="bam-mobile-color-confirm" style="flex:1; background:#4a6cf7; border:none; color:#fff; padding:12px 14px; border-radius:10px; font-size:14px; font-weight:600;">确定</button>
            </div>
            <div class="bam-mobile-color-bottom-drag" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding-top:14px; margin-top:10px; border-top:1px solid rgba(255,255,255,0.06); cursor:grab; touch-action:none; user-select:none;">
              <span style="display:inline-flex; flex-direction:column; gap:3px; opacity:0.34;">
                <span style="display:block; width:26px; height:2px; border-radius:999px; background:rgba(255,255,255,0.5);"></span>
                <span style="display:block; width:26px; height:2px; border-radius:999px; background:rgba(255,255,255,0.5);"></span>
              </span>
              <span style="color:#7d7d93; font-size:11px; line-height:1;">这里也能拖动面板</span>
            </div>
          </div>
        </div>
      </div>`;
    doc.body.appendChild(overlay);

    const backdrop = overlay.querySelector('.bam-mobile-color-backdrop');
    const shell = overlay.querySelector('.bam-mobile-color-shell');
    const card = overlay.querySelector('.bam-mobile-color-card');
    const dragHandle = overlay.querySelector('.bam-mobile-color-drag-handle');
    const bottomDragHandle = overlay.querySelector('.bam-mobile-color-bottom-drag');
    const dragTargets = [dragHandle, bottomDragHandle].filter(Boolean);
    const previewEl = overlay.querySelector('.bam-mobile-color-preview');
    const hexInput = overlay.querySelector('.bam-mobile-color-hex');
    const rangeEls = Array.from(overlay.querySelectorAll('.bam-mobile-color-range'));
    const valueEls = Array.from(overlay.querySelectorAll('.bam-mobile-color-value'));
    const state = { ...current };
    let dialogPosition = { left: 14, top: 72 };
    let dragState = null;
    let viewportBindings = null;
    let shellPaddingX = 14;
    let preferredTop = 72;
    let preferredBottom = 22;

    const clampNumber = (value, min, max) => {
      if (max < min) return min;
      return Math.min(Math.max(value, min), max);
    };
    const computeDialogMetrics = () => {
      const metrics = this._getViewportMetrics();
      shellPaddingX = metrics.width <= 420 ? 14 : 18;
      preferredTop = Math.max(56, Math.min(112, Math.round(metrics.height * 0.16)));
      preferredBottom = Math.max(18, Math.min(30, Math.round(metrics.height * 0.05)));
      const maxHeight = Math.max(220, metrics.height - preferredTop - preferredBottom);
      const dialogWidth = Math.min(360, Math.max(260, metrics.width - shellPaddingX * 2));
      return { ...metrics, maxHeight, dialogWidth };
    };
    const clampDialogPosition = (left, top) => {
      const shellRect = shell.getBoundingClientRect();
      const cardWidth = Math.max(260, Math.round(card.offsetWidth || 0));
      const cardHeight = Math.max(220, Math.round(card.offsetHeight || 0));
      const maxLeft = Math.max(shellPaddingX, shellRect.width - cardWidth - shellPaddingX);
      const maxTop = Math.max(12, shellRect.height - cardHeight - preferredBottom);
      return {
        left: clampNumber(left, shellPaddingX, maxLeft),
        top: clampNumber(top, 12, maxTop)
      };
    };
    const applyDialogPosition = (left, top) => {
      dialogPosition = clampDialogPosition(left, top);
      card.style.left = `${dialogPosition.left}px`;
      card.style.top = `${dialogPosition.top}px`;
    };
    const syncUI = (syncHex = true) => {
      const hex = this._rgbToHex(state.r, state.g, state.b);
      previewEl.style.background = hex;
      if (syncHex) hexInput.value = hex;
      rangeEls.forEach((el) => { el.value = `${state[el.dataset.channel]}`; });
      valueEls.forEach((el) => { el.textContent = `${state[el.dataset.channel]}`; });
    };
    const applyHex = (value) => {
      const normalized = this._normalizeHexColor(value, null);
      if (!normalized) return false;
      const rgb = this._hexToRgb(normalized);
      state.r = rgb.r;
      state.g = rgb.g;
      state.b = rgb.b;
      syncUI();
      return true;
    };
    const setDragCursor = (cursor) => {
      dragTargets.forEach((el) => {
        el.style.cursor = cursor;
      });
    };
    const finishDrag = (event) => {
      if (!dragState?.active) return;
      if (event?.pointerId !== undefined && dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
      const activeTarget = dragState.dragTarget;
      if (dragState.pointerId !== null && activeTarget?.hasPointerCapture?.(dragState.pointerId)) {
        try { activeTarget.releasePointerCapture(dragState.pointerId); } catch (_) { /* ignore */ }
      }
      dragState = null;
      setDragCursor('grab');
      card.style.transition = 'left 0.12s ease-out, top 0.12s ease-out';
      doc.body.style.userSelect = '';
    };
    const syncDialogViewport = ({ recenter = false } = {}) => {
      const { width, height, offsetTop, offsetLeft, maxHeight, dialogWidth } = computeDialogMetrics();
      shell.style.left = `${offsetLeft}px`;
      shell.style.top = `${offsetTop}px`;
      shell.style.width = `${width}px`;
      shell.style.height = `${height}px`;
      card.style.width = `${dialogWidth}px`;
      card.style.maxHeight = `${maxHeight}px`;
      const nextLeft = recenter ? (width - dialogWidth) / 2 : dialogPosition.left;
      const nextTop = recenter ? preferredTop : dialogPosition.top;
      applyDialogPosition(nextLeft, nextTop);
    };
    const teardownViewportSync = () => {
      if (!viewportBindings) return;
      mainWindow.removeEventListener('resize', viewportBindings);
      mainWindow.removeEventListener('orientationchange', viewportBindings);
      mainWindow.visualViewport?.removeEventListener('resize', viewportBindings);
      mainWindow.visualViewport?.removeEventListener('scroll', viewportBindings);
      viewportBindings = null;
    };
    const closeDialog = () => {
      teardownViewportSync();
      finishDrag();
      overlay.remove();
    };

    syncDialogViewport({ recenter: true });
    viewportBindings = () => syncDialogViewport();
    mainWindow.addEventListener('resize', viewportBindings, { passive: true });
    mainWindow.addEventListener('orientationchange', viewportBindings, { passive: true });
    mainWindow.visualViewport?.addEventListener('resize', viewportBindings, { passive: true });
    mainWindow.visualViewport?.addEventListener('scroll', viewportBindings, { passive: true });

    const beginDrag = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea, label, a')) return;
      event.preventDefault();
      const dragTarget = event.currentTarget;
      dragState = {
        active: true,
        pointerId: event.pointerId ?? null,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: dialogPosition.left,
        originTop: dialogPosition.top,
        dragTarget
      };
      setDragCursor('grabbing');
      card.style.transition = 'none';
      doc.body.style.userSelect = 'none';
      dragTarget?.setPointerCapture?.(event.pointerId);
    };
    const onDragMove = (event) => {
      if (!dragState?.active) return;
      if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
      applyDialogPosition(
        dragState.originLeft + (event.clientX - dragState.startX),
        dragState.originTop + (event.clientY - dragState.startY),
      );
    };
    dragTargets.forEach((target) => {
      target.addEventListener('pointerdown', beginDrag);
      target.addEventListener('pointermove', onDragMove);
      target.addEventListener('pointerup', finishDrag);
      target.addEventListener('pointercancel', finishDrag);
      target.addEventListener('lostpointercapture', finishDrag);
    });

    overlay.querySelectorAll('.bam-mobile-color-cancel').forEach((btn) => {
      btn.addEventListener('click', closeDialog);
    });
    backdrop?.addEventListener('click', closeDialog);
    overlay.querySelector('.bam-mobile-color-confirm')?.addEventListener('click', () => {
      const nextColor = this._rgbToHex(state.r, state.g, state.b);
      closeDialog();
      onConfirm?.(nextColor);
    });
    rangeEls.forEach((el) => {
      el.addEventListener('input', () => {
        state[el.dataset.channel] = Number.parseInt(el.value, 10) || 0;
        syncUI();
      });
    });
    overlay.querySelectorAll('.bam-mobile-color-preset').forEach((btn) => {
      btn.addEventListener('click', () => applyHex(btn.dataset.color));
    });
    hexInput?.addEventListener('change', () => {
      if (!applyHex(hexInput.value)) syncUI();
    });
    hexInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!applyHex(hexInput.value)) syncUI();
      }
    });
    return true;
  }

  /**
   * 为面板内所有 <input type="color"> 设置统一颜色弹窗。
   */
  _setupColorPickerProxy() {
    const doc = this._getMainDocument();
    const container = doc.getElementById('bam-container');
    if (!container) return;

    container.addEventListener('click', (e) => {
      const colorInput = e.target.closest('input[type="color"]');
      if (!colorInput) return;
      e.preventDefault();
      e.stopPropagation();
      this._openMobileColorDialog({
        title: colorInput.title || '选择颜色',
        initialValue: colorInput.value,
        onConfirm: (nextColor) => {
          colorInput.value = nextColor;
          colorInput.dispatchEvent(new Event('input', { bubbles: true }));
          colorInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }, true);
  }

  /**
   * 获取主页面 document
   */
  _getMainDocument() {
    try { return parent.document || document; } catch { return document; }
  }

  /**
   * 获取主页面 window
   */
  _getMainWindow() {
    try { return parent.window || parent || window; } catch { return window; }
  }

  /**
   * 获取当前可见视口尺寸（优先使用 visualViewport，兼容移动端）
   */
  _getViewportMetrics() {
    const mainWindow = this._mainWindow || this._getMainWindow();
    const viewport = mainWindow.visualViewport;
    const width = Math.max(320, Math.round(viewport?.width || mainWindow.innerWidth || document.documentElement.clientWidth || 0));
    const height = Math.max(320, Math.round(viewport?.height || mainWindow.innerHeight || document.documentElement.clientHeight || 0));
    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
    const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft || 0));
    return { width, height, offsetTop, offsetLeft };
  }

  /**
   * 生成遮罩层样式，避免移动端 100vh / safe-area 导致错位
   */
  _buildOverlayStyles() {
    const { width, height, offsetTop, offsetLeft } = this._getViewportMetrics();
    const panelMaxHeight = Math.max(height - 32, 220);
    return `
      #bam-container {
        position:fixed!important;
        top:${offsetTop}px!important;
        left:${offsetLeft}px!important;
        width:${width}px!important;
        height:${height}px!important;
        min-height:${height}px!important;
        background:rgba(0,0,0,0.7)!important;
        z-index:99999!important;
        display:flex!important;
        align-items:flex-start!important;
        justify-content:center!important;
        margin:0!important;
        padding:16px!important;
        padding-top:calc(env(safe-area-inset-top) + 16px)!important;
        padding-right:calc(env(safe-area-inset-right) + 16px)!important;
        padding-bottom:calc(env(safe-area-inset-bottom) + 16px)!important;
        padding-left:calc(env(safe-area-inset-left) + 16px)!important;
        box-sizing:border-box!important;
        overflow:auto!important;
        overscroll-behavior:contain!important;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif!important;
      }
      #bam-panel {
        width:100%!important;
        max-width:460px!important;
        max-height:${panelMaxHeight}px!important;
        margin:0 auto!important;
        flex:0 0 auto!important;
      }
      @media (max-width: 640px) {
        #bam-container {
          padding:12px!important;
          padding-top:calc(env(safe-area-inset-top) + 12px)!important;
          padding-right:calc(env(safe-area-inset-right) + 12px)!important;
          padding-bottom:calc(env(safe-area-inset-bottom) + 12px)!important;
          padding-left:calc(env(safe-area-inset-left) + 12px)!important;
        }
        #bam-panel {
          max-width:100%!important;
          border-radius:14px!important;
        }
      }
    `;
  }

  _syncOverlayLayout() {
    const doc = this._getMainDocument();
    const styleEl = doc.getElementById('bam-style');
    if (!styleEl) return;
    styleEl.textContent = this._buildOverlayStyles();
    this._syncPanelPosition();
  }

  _bindViewportSync() {
    if (!this._mainWindow || this._syncOverlayLayoutBound) return;
    this._syncOverlayLayoutBound = () => this._syncOverlayLayout();
    this._mainWindow.addEventListener('resize', this._syncOverlayLayoutBound, { passive: true });
    this._mainWindow.addEventListener('orientationchange', this._syncOverlayLayoutBound, { passive: true });
    this._mainWindow.visualViewport?.addEventListener('resize', this._syncOverlayLayoutBound, { passive: true });
    this._mainWindow.visualViewport?.addEventListener('scroll', this._syncOverlayLayoutBound, { passive: true });
  }

  _unbindViewportSync() {
    if (!this._mainWindow || !this._syncOverlayLayoutBound) return;
    this._mainWindow.removeEventListener('resize', this._syncOverlayLayoutBound);
    this._mainWindow.removeEventListener('orientationchange', this._syncOverlayLayoutBound);
    this._mainWindow.visualViewport?.removeEventListener('resize', this._syncOverlayLayoutBound);
    this._mainWindow.visualViewport?.removeEventListener('scroll', this._syncOverlayLayoutBound);
    this._syncOverlayLayoutBound = null;
  }

  _getPanelElements() {
    const doc = this._getMainDocument();
    return {
      container: doc.getElementById('bam-container'),
      panel: doc.getElementById('bam-panel'),
      handle: doc.getElementById('bam-drag-handle')
    };
  }

  _applyPanelOffset() {
    const { panel } = this._getPanelElements();
    if (!panel) return;
    panel.style.transform = `translate(${this._panelOffset.x}px, ${this._panelOffset.y}px)`;
  }

  _clampPanelOffset(nextX, nextY) {
    const { container, panel } = this._getPanelElements();
    if (!container || !panel) return { x: nextX, y: nextY };

    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const currentOffset = this._panelOffset || { x: 0, y: 0 };
    const baseLeft = panelRect.left - currentOffset.x;
    const baseTop = panelRect.top - currentOffset.y;
    const safePadding = 8;
    const clampAxis = (value, min, max) => {
      if (max < min) return min;
      return Math.min(Math.max(value, min), max);
    };

    return {
      x: clampAxis(nextX, containerRect.left + safePadding - baseLeft, containerRect.right - safePadding - panelRect.width - baseLeft),
      y: clampAxis(nextY, containerRect.top + safePadding - baseTop, containerRect.bottom - safePadding - panelRect.height - baseTop)
    };
  }

  _syncPanelPosition() {
    this._panelOffset = this._clampPanelOffset(this._panelOffset.x, this._panelOffset.y);
    this._applyPanelOffset();
  }

  _setupPanelDrag() {
    if (this._panelDragBindings) return;
    const doc = this._getMainDocument();
    const { panel, handle } = this._getPanelElements();
    if (!panel || !handle) return;

    const finishDrag = (event) => {
      const dragState = this._panelDragState;
      if (!dragState?.active) return;
      if (event?.pointerId !== undefined && dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
      if (dragState.pointerId !== null && handle.hasPointerCapture?.(dragState.pointerId)) {
        try { handle.releasePointerCapture(dragState.pointerId); } catch (_) { /* ignore */ }
      }
      this._panelDragState = null;
      handle.style.cursor = 'grab';
      panel.style.transition = 'transform 0.12s ease-out';
      doc.body.style.userSelect = '';
    };

    const onPointerMove = (event) => {
      const dragState = this._panelDragState;
      if (!dragState?.active) return;
      if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      this._panelOffset = this._clampPanelOffset(
        dragState.originX + deltaX,
        dragState.originY + deltaY,
      );
      this._applyPanelOffset();
    };

    const onPointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea, label, a')) return;
      event.preventDefault();
      this._panelDragState = {
        active: true,
        pointerId: event.pointerId ?? null,
        startX: event.clientX,
        startY: event.clientY,
        originX: this._panelOffset.x,
        originY: this._panelOffset.y
      };
      handle.style.cursor = 'grabbing';
      panel.style.transition = 'none';
      doc.body.style.userSelect = 'none';
      handle.setPointerCapture?.(event.pointerId);
    };

    const onWindowBlur = () => finishDrag();

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    this._mainWindow?.addEventListener('blur', onWindowBlur);

    this._panelDragBindings = { onPointerDown, onPointerMove, finishDrag, onWindowBlur };
  }

  _teardownPanelDrag() {
    const doc = this._getMainDocument();
    const { handle } = this._getPanelElements();
    if (this._panelDragBindings && handle) {
      handle.removeEventListener('pointerdown', this._panelDragBindings.onPointerDown);
      handle.removeEventListener('pointermove', this._panelDragBindings.onPointerMove);
      handle.removeEventListener('pointerup', this._panelDragBindings.finishDrag);
      handle.removeEventListener('pointercancel', this._panelDragBindings.finishDrag);
      handle.removeEventListener('lostpointercapture', this._panelDragBindings.finishDrag);
    }
    this._mainWindow?.removeEventListener('blur', this._panelDragBindings?.onWindowBlur);
    const pointerId = this._panelDragState?.pointerId;
    if (pointerId !== undefined && pointerId !== null && handle?.hasPointerCapture?.(pointerId)) {
      try { handle.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
    }
    doc.body.style.userSelect = '';
    this._panelDragBindings = null;
    this._panelDragState = null;
  }

  _getBubbleRenderFrames() {
    const doc = this._getMainDocument();
    return Array.from(doc.querySelectorAll('iframe')).filter((frame) => {
      try {
        if (typeof frame.srcdoc === 'string' && frame.srcdoc.includes('id="dcRoot"')) return true;
        return Boolean(frame.contentDocument?.getElementById('dcRoot'));
      } catch (_) {
        return false;
      }
    });
  }

  _getDialogueLineHeight(fontSize, spacing) {
    const safeFontSize = Number.isFinite(fontSize) ? fontSize : STYLE_DEFAULTS.style_dialogueFontSize;
    const safeSpacing = Number.isFinite(spacing) ? spacing : STYLE_DEFAULTS.style_dialogueSpacing;
    const computed = Math.max(safeFontSize * 1.35, safeFontSize + safeSpacing);
    return Math.round(computed * 100) / 100;
  }

  _composeFontStack(family, fallbackStack) {
    const safeFamily = typeof family === 'string' ? family.trim() : '';
    return safeFamily ? `"${safeFamily.replace(/"/g, '\\"')}",${fallbackStack}` : fallbackStack;
  }

  _getDefaultStyleSettings() {
    return { ...STYLE_DEFAULTS };
  }

  _getFontCacheKey(url) {
    return `${FONT_CACHE_PREFIX}${url}`;
  }

  _readCachedRemoteFontOptions(url) {
    if (!url) return [];
    try {
      const raw = localStorage.getItem(this._getFontCacheKey(url));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.fonts) ? parsed.fonts : [];
    } catch (_) {
      return [];
    }
  }

  _writeCachedRemoteFontOptions(url, fonts) {
    if (!url) return;
    try {
      localStorage.setItem(this._getFontCacheKey(url), JSON.stringify({
        version: '1.0',
        savedAt: Date.now(),
        fonts,
      }));
    } catch (_) {
      // ignore cache errors
    }
  }

  async _fetchRemoteFontOptions(url, { forceRefresh = false, silent = true } = {}) {
    const trimmedUrl = typeof url === 'string' ? url.trim() : '';
    if (!trimmedUrl) return [];

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetch(trimmedUrl, {
        method: 'GET',
        cache: forceRefresh ? 'no-store' : 'default',
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const fonts = normalizeFontPayload(payload);
      this._writeCachedRemoteFontOptions(trimmedUrl, fonts);
      return fonts;
    } catch (err) {
      const cachedFonts = this._readCachedRemoteFontOptions(trimmedUrl);
      if (cachedFonts.length) return cachedFonts;
      if (!silent) throw err;
      console.warn('拉取远程字体配置失败:', trimmedUrl, err);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async _getAvailableFontOptions(url, options = {}) {
    const builtins = BUILTIN_FONT_OPTIONS.map((font) => ({ ...font }));
    const familySet = new Set(builtins.map((font) => font.family));
    const merged = [...builtins];

    // 本地上传字体
    try {
      const localFonts = await this.db.listLocalFonts();
      localFonts.forEach((f) => {
        if (familySet.has(f.family)) return;
        familySet.add(f.family);
        merged.push({ id: f.id, name: `${f.family}（本地）`, family: f.family, type: 'local' });
      });
    } catch (_) { /* ignore */ }

    // CSS 字体源
    try {
      const cssSources = await this.db.getCssFontSources();
      cssSources.forEach((src) => {
        (src.families || []).forEach((family) => {
          if (familySet.has(family)) return;
          familySet.add(family);
          merged.push({ id: `css-${family}`, name: `${family}（CSS）`, family, type: 'css', url: src.url });
        });
      });
    } catch (_) { /* ignore */ }

    // 远程 JSON 字体
    const remoteFonts = await this._fetchRemoteFontOptions(url, options);
    remoteFonts.forEach((font) => {
      if (familySet.has(font.family)) return;
      familySet.add(font.family);
      merged.push({ ...font });
    });
    return merged;
  }

  _applyFontOptionsToSelect(selectEl, options, selectedFamily, fallbackFamily) {
    if (!selectEl) return;
    const safeFallback = fallbackFamily || options[0]?.family || '';
    const safeSelected = selectedFamily || safeFallback;
    selectEl.innerHTML = options.map((font) => {
      const selectedAttr = font.family === safeSelected ? ' selected' : '';
      return `<option value="${font.family.replace(/"/g, '&quot;')}"${selectedAttr}>${font.name}</option>`;
    }).join('');
    selectEl.value = safeSelected;
    if (!selectEl.value && safeFallback) selectEl.value = safeFallback;
  }

  async _refreshFontSelectors({ forceRemote = false, silent = true } = {}) {
    const doc = this._getMainDocument();
    const url = doc.getElementById('bam-font-url-input')?.value?.trim() || '';
    const options = await this._getAvailableFontOptions(url, { forceRefresh: forceRemote, silent });
    this._applyFontOptionsToSelect(doc.getElementById('bam-select-narration-font'), options, doc.getElementById('bam-select-narration-font')?.value, STYLE_DEFAULTS.style_narrationFontFamily);
    this._applyFontOptionsToSelect(doc.getElementById('bam-select-dialogue-font'), options, doc.getElementById('bam-select-dialogue-font')?.value, STYLE_DEFAULTS.style_dialogueFontFamily);
    this._applyFontOptionsToSelect(doc.getElementById('bam-select-name-font'), options, doc.getElementById('bam-select-name-font')?.value, STYLE_DEFAULTS.style_nameFontFamily);
    return options;
  }

  _syncFrameFontLinks(frameDoc, fonts) {
    if (!frameDoc?.head) return;
    const cssFonts = fonts.filter((font) => font.type === 'css' && font.url);
    cssFonts.forEach((font) => {
      const exists = Array.from(frameDoc.head.querySelectorAll('link[data-bam-font-url]')).some((node) => node.dataset.bamFontUrl === font.url);
      if (exists) return;
      const link = frameDoc.createElement('link');
      link.rel = 'stylesheet';
      link.href = font.url;
      link.dataset.bamFontUrl = font.url;
      frameDoc.head.appendChild(link);
    });

    const fileFonts = fonts.filter((font) => font.type === 'file' && font.url && font.family);
    if (!fileFonts.length) return;
    let styleEl = frameDoc.getElementById('bam-remote-font-face-style');
    if (!styleEl) {
      styleEl = frameDoc.createElement('style');
      styleEl.id = 'bam-remote-font-face-style';
      frameDoc.head.appendChild(styleEl);
    }
    const rules = fileFonts.map((font) => {
      const formatPart = font.format ? ` format('${font.format}')` : '';
      return `@font-face{font-family:'${font.family.replace(/'/g, "\\'")}';src:url('${font.url.replace(/'/g, "\\'")}')${formatPart};font-display:swap;}`;
    }).join('');
    if (styleEl.textContent !== rules) styleEl.textContent = rules;
  }

  async _ensurePreviewFontResources(frameDoc, settings) {
    const fonts = await this._getAvailableFontOptions(settings.style_fontConfigUrl, { silent: true });
    this._syncFrameFontLinks(frameDoc, fonts);

    // 注入本地字体的 @font-face
    try {
      const localFonts = await this.db.listLocalFonts();
      if (localFonts.length && frameDoc?.head) {
        let styleEl = frameDoc.getElementById('bam-local-font-face-style');
        if (!styleEl) {
          styleEl = frameDoc.createElement('style');
          styleEl.id = 'bam-local-font-face-style';
          frameDoc.head.appendChild(styleEl);
        }
        const rules = localFonts
          .filter(f => f.fontBlob && f.family)
          .map(f => {
            const blobUrl = URL.createObjectURL(f.fontBlob);
            const formatPart = f.format ? ` format('${f.format}')` : '';
            return `@font-face{font-family:'${f.family.replace(/'/g, "\\'")}';src:url('${blobUrl}')${formatPart};font-display:swap;}`;
          }).join('');
        if (styleEl.textContent !== rules) styleEl.textContent = rules;
      }
    } catch (_) { /* ignore */ }

    // 注入 CSS 字体源的 <link>
    try {
      const cssSources = await this.db.getCssFontSources();
      cssSources.forEach((src) => {
        if (!src.url || !frameDoc?.head) return;
        const exists = Array.from(frameDoc.head.querySelectorAll('link[data-bam-css-font-url]'))
          .some(node => node.dataset.bamCssFontUrl === src.url);
        if (exists) return;
        const link = frameDoc.createElement('link');
        link.rel = 'stylesheet';
        link.href = src.url;
        link.dataset.bamCssFontUrl = src.url;
        frameDoc.head.appendChild(link);
      });
    } catch (_) { /* ignore */ }

    return fonts;
  }

  _getLiveStyleSettings() {
    const doc = this._getMainDocument();
    const defaults = this._getDefaultStyleSettings();
    const getNumberValue = (id, fallback) => {
      const raw = doc.getElementById(id)?.value;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const getCheckedValue = (name, fallback) => doc.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
    const getSelectValue = (id, fallback) => doc.getElementById(id)?.value || fallback;

    return {
      style_dialogueFontSize: getNumberValue('bam-range-dialogue-font', defaults.style_dialogueFontSize),
      style_narrationFontSize: getNumberValue('bam-range-narration-font', defaults.style_narrationFontSize),
      style_dialogueSpacing: getNumberValue('bam-range-dialogue-spacing', defaults.style_dialogueSpacing),
      style_textColorMode: getCheckedValue('bam-color-mode', defaults.style_textColorMode),
      style_globalTextColor: doc.getElementById('bam-global-color-picker')?.value || defaults.style_globalTextColor,
      style_markdownMode: getCheckedValue('bam-md-mode', defaults.style_markdownMode),
      style_dialogueFontWeight: getNumberValue('bam-range-dialogue-weight', defaults.style_dialogueFontWeight),
      style_narrationFontWeight: getNumberValue('bam-range-narration-weight', defaults.style_narrationFontWeight),
      style_nameFontWeight: getNumberValue('bam-range-name-weight', defaults.style_nameFontWeight),
      style_narrationBgColor: doc.getElementById('bam-narration-bg-color')?.value || defaults.style_narrationBgColor,
      style_narrationBgOpacity: getNumberValue('bam-range-narration-bg-opacity', defaults.style_narrationBgOpacity),
      style_avatarSize: getNumberValue('bam-range-avatar-size', defaults.style_avatarSize),
      style_narrationIndent: getNumberValue('bam-range-narration-indent', defaults.style_narrationIndent),
      style_narrationFontFamily: getSelectValue('bam-select-narration-font', defaults.style_narrationFontFamily),
      style_dialogueFontFamily: getSelectValue('bam-select-dialogue-font', defaults.style_dialogueFontFamily),
      style_nameFontFamily: getSelectValue('bam-select-name-font', defaults.style_nameFontFamily),
      style_fontConfigUrl: doc.getElementById('bam-font-url-input')?.value?.trim() || defaults.style_fontConfigUrl,
      style_narrationBorderRadius: getNumberValue('bam-range-narration-border-radius', defaults.style_narrationBorderRadius),
      style_avatarShape: getCheckedValue('bam-avatar-shape', defaults.style_avatarShape),
      style_thoughtSuffixGap: getNumberValue('bam-range-thought-suffix-gap', defaults.style_thoughtSuffixGap),
      style_thoughtSuffixOffsetY: getNumberValue('bam-range-thought-suffix-offset-y', defaults.style_thoughtSuffixOffsetY),
      // v7.0
      style_narrationTextIndent: getNumberValue('bam-range-narration-text-indent', defaults.style_narrationTextIndent),
      style_narrationLineHeight: getNumberValue('bam-range-narration-line-height', defaults.style_narrationLineHeight),
      style_narrationPaddingRight: getNumberValue('bam-range-narration-padding-right', defaults.style_narrationPaddingRight),
      style_imageCompressEnabled: doc.getElementById('bam-chk-compress-enabled')?.checked !== false,
      style_imageCompressQuality: getNumberValue('bam-range-compress-quality', defaults.style_imageCompressQuality),
    };
  }

  async _applyBubblePreviewStyles(styleSettings = null) {
    const settings = { ...this._getDefaultStyleSettings(), ...(styleSettings || this._getLiveStyleSettings()) };
    const frames = this._getBubbleRenderFrames();
    if (!frames.length) return false;

    const dialogueLineHeight = this._getDialogueLineHeight(settings.style_dialogueFontSize, settings.style_dialogueSpacing);
    const narrationBackground = hexToRgba(settings.style_narrationBgColor, settings.style_narrationBgOpacity);
    const avatarSize = clampNumber(settings.style_avatarSize, 36, 88);
    const narrationIndent = clampNumber(settings.style_narrationIndent, 0, 120);
    const narrationFontStack = this._composeFontStack(settings.style_narrationFontFamily, '"Source Han Sans SC",sans-serif');
    const dialogueFontStack = this._composeFontStack(settings.style_dialogueFontFamily, '"Source Han Serif SC",serif');
    const nameFontStack = this._composeFontStack(settings.style_nameFontFamily, '"Source Han Serif SC",serif');
    const narrationBorderRadius = clampNumber(settings.style_narrationBorderRadius, 0, 24);
    const avatarShapeRadius = settings.style_avatarShape === 'circle' ? '50%' : settings.style_avatarShape === 'square' ? '0px' : '8px';
    const thoughtSuffixGap = clampNumber(settings.style_thoughtSuffixGap, 0, 24);
    const thoughtSuffixOffsetY = clampNumber(settings.style_thoughtSuffixOffsetY, -24, 24);

    for (const frame of frames) {
      let frameDoc;
      try {
        frameDoc = frame.contentDocument;
      } catch (_) {
        continue;
      }
      const root = frameDoc?.getElementById('dcRoot');
      if (!root) continue;

      await this._ensurePreviewFontResources(frameDoc, settings);

      const msgNodes = Array.from(root.querySelectorAll('.dc-msg'));
      const nameColors = new Map();
      if (settings.style_textColorMode === 'character' && msgNodes.length) {
        const charId = this._charId || getCurrentCharId() || GLOBAL_CHAR_ID;
        const names = [...new Set(msgNodes.map((msg) => msg.dataset.name?.trim().toLowerCase()).filter(Boolean))];
        await Promise.all(names.map(async (n) => {
          nameColors.set(n, await this.db.getConfig(buildColorConfigKey(charId, n), null));
        }));
      }

      msgNodes.forEach((msg) => {
        const textEl = msg.querySelector('.dc-msg-text');
        if (!textEl) return;
        const msgName = msg.dataset.name?.trim().toLowerCase();
        const textColor = settings.style_textColorMode === 'character'
          ? nameColors.get(msgName) || settings.style_globalTextColor
          : settings.style_globalTextColor;
        const messagePaddingLeft = avatarSize + 24;
        textEl.style.fontSize = `${settings.style_dialogueFontSize}px`;
        textEl.style.lineHeight = `${dialogueLineHeight}px`;
        textEl.style.color = textColor;
        textEl.style.fontWeight = String(settings.style_dialogueFontWeight);
        textEl.style.fontFamily = dialogueFontStack;
        const thoughtTextEl = msg.querySelector('.dc-msg-text-content-thought');
        if (thoughtTextEl) {
          thoughtTextEl.style.display = 'inline';
          thoughtTextEl.style.maxWidth = '';
          thoughtTextEl.style.transform = 'none';
          thoughtTextEl.style.transformOrigin = '';
          thoughtTextEl.style.verticalAlign = 'baseline';
        }
        const thoughtQuoteEl = msg.querySelector('.dc-msg-quote-thought');
        if (thoughtQuoteEl) {
          thoughtQuoteEl.style.marginLeft = `${thoughtSuffixGap}px`;
          thoughtQuoteEl.style.top = `${thoughtSuffixOffsetY}px`;
          thoughtQuoteEl.style.lineHeight = '1';
          thoughtQuoteEl.style.height = 'auto';
          thoughtQuoteEl.style.verticalAlign = 'baseline';
        }

        const nameEl = msg.querySelector('.dc-msg-name');
        if (nameEl) {
          nameEl.style.color = settings.style_globalTextColor;
          nameEl.style.fontWeight = String(settings.style_nameFontWeight);
          nameEl.style.fontFamily = nameFontStack;
        }
        msg.querySelectorAll('.dc-cn').forEach((charEl) => {
          charEl.style.color = settings.style_globalTextColor;
        });

        const avatarEl = msg.querySelector('.dc-msg-avatar');
        if (avatarEl) {
          avatarEl.style.width = `${avatarSize}px`;
          avatarEl.style.height = `${avatarSize}px`;
          avatarEl.style.borderRadius = avatarShapeRadius;
        }
        const avatarImg = msg.querySelector('.dc-msg-avatar img');
        if (avatarImg) {
          avatarImg.style.width = '100%';
          avatarImg.style.height = '100%';
          avatarImg.style.borderRadius = avatarShapeRadius;
        }
        const avatarPlaceholder = msg.querySelector('.dc-msg-avatar-ph');
        if (avatarPlaceholder) {
          avatarPlaceholder.style.fontSize = `${Math.max(16, Math.round(avatarSize * 0.38))}px`;
          avatarPlaceholder.style.borderRadius = avatarShapeRadius;
        }
        msg.style.paddingLeft = `${messagePaddingLeft}px`;
        msg.style.minHeight = `${Math.max(56, avatarSize + 4)}px`;
      });

      root.querySelectorAll('.dc-narration-block').forEach((narrationEl) => {
        narrationEl.style.fontSize = `${settings.style_narrationFontSize}px`;
        narrationEl.style.color = settings.style_globalTextColor;
        narrationEl.style.fontWeight = String(settings.style_narrationFontWeight);
        narrationEl.style.fontFamily = narrationFontStack;
        narrationEl.style.background = narrationBackground;
        narrationEl.style.paddingLeft = `${narrationIndent}px`;
        narrationEl.style.borderRadius = `${narrationBorderRadius}px`;
        narrationEl.style.lineHeight = String(clampNumber(settings.style_narrationLineHeight, 1.2, 3.0));
        narrationEl.style.paddingRight = `${clampNumber(settings.style_narrationPaddingRight, 0, 120)}px`;
        narrationEl.querySelectorAll('p').forEach((p) => {
          p.style.textIndent = `${clampNumber(settings.style_narrationTextIndent, 0, 4)}em`;
        });
      });
    }

    return true;
  }

  _reloadBubbleFrame(frame) {
    try {
      if (typeof frame.srcdoc === 'string' && frame.srcdoc.includes('id="dcRoot"')) {
        const cachedBaseSrcdoc = frame.dataset.bamBaseSrcdoc;
        const normalizedSrcdoc = typeof cachedBaseSrcdoc === 'string' && cachedBaseSrcdoc.includes('id="dcRoot"')
          ? cachedBaseSrcdoc
          : frame.srcdoc.replace(/\n<!-- bam-refresh:\d+ -->$/u, '');
        frame.dataset.bamBaseSrcdoc = normalizedSrcdoc;
        frame.srcdoc = `${normalizedSrcdoc}\n<!-- bam-refresh:${Date.now()} -->`;
        return true;
      }
      frame.contentWindow?.location?.reload?.();
      return true;
    } catch (err) {
      console.warn('Bubble 预览刷新失败:', err);
      return false;
    }
  }

  _refreshBubblePreview() {
    const frames = this._getBubbleRenderFrames();
    if (!frames.length) {
      console.warn('Bubble 预览刷新跳过：未找到可重载的气泡 iframe');
      return;
    }
    frames.forEach((frame) => this._reloadBubbleFrame(frame));
  }

  _scheduleBubblePreviewRefresh(delay = 80) {
    if (this._livePreviewTimer) clearTimeout(this._livePreviewTimer);
    this._livePreviewTimer = setTimeout(() => {
      this._livePreviewTimer = null;
      this._refreshBubblePreview();
    }, delay);
  }

  _requestBubblePreviewRefresh(delay = 80, deferUntilPanelClose = false) {
    if (deferUntilPanelClose && this.isOpen) {
      this._pendingBubbleRefreshDelay = this._pendingBubbleRefresh
        ? Math.min(this._pendingBubbleRefreshDelay, delay)
        : delay;
      this._pendingBubbleRefresh = true;
      return;
    }
    this._scheduleBubblePreviewRefresh(delay);
  }

  _requestAvatarAssetPreviewRefresh(delay = 80) {
    this._requestBubblePreviewRefresh(delay, true);
  }

  async open() {
    if (this.isOpen) { this.close(); }
    this.isOpen = true;
    try {
      await this.db.init();

      this._charId = getCurrentCharId() || GLOBAL_CHAR_ID;
      this._charName = getCurrentCharName();
      this._expandedMoodName = null;

      const doc = this._getMainDocument();
      this._mainWindow = this._getMainWindow();

      const styleEl = doc.createElement('style');
      styleEl.id = 'bam-style';
      doc.head.appendChild(styleEl);
      this._syncOverlayLayout();
      this._bindViewportSync();

      if (this._mainWindow?.document !== doc) {
        console.warn('AvatarManagerPanel: 主窗口与主文档不一致，已回退使用父页面文档渲染');
      }

      const container = doc.createElement('div');
      container.id = 'bam-container';
      container.innerHTML = this._panelHTML();
      doc.body.appendChild(container);
      this._panelOffset = { x: 0, y: 0 };
      this._setupPanelDrag();
      this._syncPanelPosition();
      this._setupColorPickerProxy();

      this._bindEvents();
      await this._refreshList();
    } catch (err) {
      this.isOpen = false;
      console.error('[BubbleDialogue] open() 执行出错:', err);
      throw err;
    }
  }

  close() {
    const doc = this._getMainDocument();
    const shouldRefreshAfterClose = this._pendingBubbleRefresh;
    const refreshDelay = this._pendingBubbleRefreshDelay;
    this._unbindViewportSync();
    this._teardownPanelDrag();
    if (this._livePreviewTimer) {
      clearTimeout(this._livePreviewTimer);
      this._livePreviewTimer = null;
    }
    const el = doc.getElementById('bam-container');
    if (el) el.remove();
    const st = doc.getElementById('bam-style');
    if (st) st.remove();
    this._mainWindow = null;
    this.pendingFile = null;
    this._styleDraftLoaded = false;
    this._styleDraftDirty = false;
    this._moodConfigLoaded = false;
    this._moodConfigDirty = false;
    this._moodConfigDraft = null;
    this._formatRuleDraft = null;
    this._pendingBubbleRefresh = false;
    this._pendingBubbleRefreshDelay = 0;
    this._panelOffset = { x: 0, y: 0 };
    this._charId = '';
    this._charName = '';
    this._expandedMoodName = null;
    this.isOpen = false;
    if (shouldRefreshAfterClose) this._scheduleBubblePreviewRefresh(refreshDelay);
  }

  // -------------------- HTML 模板 --------------------

  _panelHTML() {
    return `
  <div id="bam-panel" style="
    background:#1a1a2e; border-radius:16px; width:460px; max-width:calc(100vw - 32px);
    display:flex; flex-direction:column;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
    border:1px solid rgba(255,255,255,0.08); overflow:hidden;
    will-change:transform; transition:transform 0.12s ease-out;
  ">
    <div id="bam-drag-handle" style="display:flex; align-items:center; justify-content:space-between;
      padding:16px 20px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:grab; touch-action:none;">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span style="display:inline-flex; flex-direction:column; gap:3px; opacity:0.45;">
          <span style="display:block; width:14px; height:2px; border-radius:999px; background:rgba(255,255,255,0.55);"></span>
          <span style="display:block; width:14px; height:2px; border-radius:999px; background:rgba(255,255,255,0.55);"></span>
        </span>
        <div style="font-size:16px; font-weight:600; color:#e0e0e0;">对话气泡</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
        <button id="bam-btn-import" style="background:rgba(255,255,255,0.06); border:none; color:#aaa;
          padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">导入</button>
        <button id="bam-btn-export" style="background:rgba(255,255,255,0.06); border:none; color:#aaa;
          padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">导出</button>
        <button id="bam-btn-close" style="background:none; border:none; color:#888;
          font-size:20px; cursor:pointer; padding:0 4px; line-height:1;">&times;</button>
      </div>
    </div>

    <div id="bam-tab-bar" style="display:flex; padding:0 20px; border-bottom:1px solid rgba(255,255,255,0.06);">
      <button class="bam-tab-btn bam-tab-active" data-tab="avatar" style="
        flex:1; padding:10px 0; border:none; background:none; color:#e0e0e0; font-size:13px;
        font-weight:600; cursor:pointer; border-bottom:2px solid #4a6cf7; transition:all 0.2s;">头像管理</button>
      <button class="bam-tab-btn" data-tab="style" style="
        flex:1; padding:10px 0; border:none; background:none; color:#666; font-size:13px;
        font-weight:500; cursor:pointer; border-bottom:2px solid transparent; transition:all 0.2s;">正文美化</button>
      <button class="bam-tab-btn" data-tab="mood" style="
        flex:1; padding:10px 0; border:none; background:none; color:#666; font-size:13px;
        font-weight:500; cursor:pointer; border-bottom:2px solid transparent; transition:all 0.2s;">情绪配置</button>
      <button class="bam-tab-btn" data-tab="live2d" style="
        flex:1; padding:10px 0; border:none; background:none; color:#666; font-size:13px;
        font-weight:500; cursor:pointer; border-bottom:2px solid transparent; transition:all 0.2s;">Live2D</button>
    </div>

    <div id="bam-tab-avatar" style="display:flex; flex-direction:column; flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;">
      <div id="bam-char-info" style="padding:8px 20px; font-size:12px; color:#888; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="opacity:0.6;">📋</span>
          <span>当前角色卡: <span id="bam-char-name" style="color:#ccc;">—</span></span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="color:#888; font-size:11px;">操作目标:</span>
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="radio" name="bam-target-scope" value="character" checked style="accent-color:#4a6cf7;" />
            <span style="color:#bbb; font-size:11px;">当前角色卡</span>
          </label>
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="radio" name="bam-target-scope" value="global" style="accent-color:#4a6cf7;" />
            <span style="color:#bbb; font-size:11px;">全局（跨卡共享）</span>
          </label>
        </div>
      </div>
      <div id="bam-upload-area" style="
        margin:16px 20px 8px; border:2px dashed rgba(255,255,255,0.12);
        border-radius:12px; padding:20px; text-align:center; cursor:pointer; transition:all 0.2s;
      ">
        <div style="font-size:28px; margin-bottom:6px;">+</div>
        <div style="color:#888; font-size:13px;">点击或拖拽图片到此处上传</div>
        <div style="color:#555; font-size:11px; margin-top:4px;">支持 JPG / PNG / GIF / WebP，最大 2MB，推荐 200×200 正方形</div>
        <input id="bam-file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none;" />
      </div>
      <div style="text-align:center; margin:0 20px 8px;">
        <button id="bam-btn-add-remote-avatar" style="background:none; border:1px dashed rgba(74,108,247,0.3); color:#8ba4f7; padding:6px 16px; border-radius:8px; cursor:pointer; font-size:12px; width:100%;">🔗 使用远程图片 URL</button>
      </div>

      <div id="bam-alias-input-area" style="display:none; margin:8px 20px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:10px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <img id="bam-preview-img" style="width:44px; height:44px; border-radius:50%; object-fit:cover; border:2px solid rgba(255,255,255,0.1);" />
          <div style="flex:1;">
            <div style="color:#ccc; font-size:12px; margin-bottom:4px;">设置角色名（AI 输出时使用的全名）</div>
            <input id="bam-alias-input" type="text" placeholder="例如: 城崎诺亚" style="width:100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px 10px; color:#e0e0e0; font-size:14px; outline:none; box-sizing:border-box;" />
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <div style="color:#ccc; font-size:12px; flex-shrink:0;">角色主题色</div>
          <div id="bam-color-presets" style="display:flex; gap:4px; flex-wrap:wrap;">
            <span class="bam-color-dot" data-color="#f47b67" style="width:22px;height:22px;border-radius:50%;background:#f47b67;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#45ddc0" style="width:22px;height:22px;border-radius:50%;background:#45ddc0;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#e78bff" style="width:22px;height:22px;border-radius:50%;background:#e78bff;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#f0b232" style="width:22px;height:22px;border-radius:50%;background:#f0b232;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#58a6ff" style="width:22px;height:22px;border-radius:50%;background:#58a6ff;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#ff9a76" style="width:22px;height:22px;border-radius:50%;background:#ff9a76;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#7ee787" style="width:22px;height:22px;border-radius:50%;background:#7ee787;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
            <span class="bam-color-dot" data-color="#d2a8ff" style="width:22px;height:22px;border-radius:50%;background:#d2a8ff;cursor:pointer;border:2px solid transparent;display:inline-block;"></span>
          </div>
          <input id="bam-color-input" type="color" value="#58a6ff" style="width:28px;height:28px;border:none;background:none;cursor:pointer;padding:0;" title="自定义颜色" />
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button id="bam-btn-cancel-upload" style="background:rgba(255,255,255,0.06); border:none; color:#aaa; padding:6px 16px; border-radius:6px; cursor:pointer; font-size:13px;">取消</button>
          <button id="bam-btn-confirm-upload" style="background:#4a6cf7; border:none; color:white; padding:6px 16px; border-radius:6px; cursor:pointer; font-size:13px;">确认添加</button>
        </div>
      </div>

      <div id="bam-avatar-list" style="flex:1; overflow-y:auto; padding:8px 20px 16px; min-height:100px;">
        <div id="bam-empty-tip" style="text-align:center; color:#555; padding:30px 0; font-size:13px;">还没有头像，点击上方区域添加</div>
      </div>

      <div id="bam-stats" style="padding:10px 20px; border-top:1px solid rgba(255,255,255,0.06); font-size:12px; color:#555; text-align:center;">已存储: 0 张 | 总计: 0 KB</div>

      <div id="bam-remote-actions" style="padding:6px 20px 10px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center; border-top:1px solid rgba(255,255,255,0.04);">
        <button id="bam-btn-fetch-remote" style="background:rgba(74,108,247,0.12); border:1px solid rgba(74,108,247,0.25); color:#b9c7ff; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:11px;">拉取远程头像</button>
        <button id="bam-btn-clear-remote-cache" style="background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.2); color:#e88; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:11px;">清除远程缓存</button>
      </div>

      <div id="bam-cg-section" style="border-top:1px solid rgba(255,255,255,0.06);">
        <div id="bam-cg-header" style="display:flex; align-items:center; justify-content:space-between; padding:10px 20px; cursor:pointer; user-select:none;" data-collapsed="true">
          <span style="color:#888; font-size:12px; font-weight:600;">CG 图片库</span>
          <span id="bam-cg-toggle" style="color:#666; font-size:11px;">▶</span>
        </div>
        <div id="bam-cg-body" style="display:none; padding:0 20px 12px; max-height:50vh; overflow-y:auto; -webkit-overflow-scrolling:touch;">
          <div id="bam-cg-group-list" style="margin-bottom:10px;"></div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="bam-btn-add-cg-group" style="background:rgba(74,108,247,0.12); border:1px solid rgba(74,108,247,0.25); color:#b9c7ff; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:11px;">手动添加组</button>
            <button id="bam-btn-clear-all-cg" style="background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.2); color:#e88; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:11px;">清除全部CG缓存</button>
          </div>
        </div>
      </div>
    </div>

    <div id="bam-tab-style" style="display:none; flex-direction:column; flex:1; overflow-y:auto; padding:16px 20px;">
      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">文字</div>

      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">台词字号</span><span id="bam-val-dialogue-font" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_dialogueFontSize}px</span></div>
        <input id="bam-range-dialogue-font" type="range" min="12" max="22" step="0.5" value="${STYLE_DEFAULTS.style_dialogueFontSize}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白字号</span><span id="bam-val-narration-font" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationFontSize}px</span></div>
        <input id="bam-range-narration-font" type="range" min="12" max="22" step="0.5" value="${STYLE_DEFAULTS.style_narrationFontSize}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">台词行距</span><span id="bam-val-dialogue-spacing" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_dialogueSpacing}px</span></div>
        <input id="bam-range-dialogue-spacing" type="range" min="4" max="24" step="1" value="${STYLE_DEFAULTS.style_dialogueSpacing}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">台词字重</span><span id="bam-val-dialogue-weight" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_dialogueFontWeight}</span></div>
        <input id="bam-range-dialogue-weight" type="range" min="100" max="900" step="10" value="${STYLE_DEFAULTS.style_dialogueFontWeight}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白字重</span><span id="bam-val-narration-weight" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationFontWeight}</span></div>
        <input id="bam-range-narration-weight" type="range" min="100" max="900" step="10" value="${STYLE_DEFAULTS.style_narrationFontWeight}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">角色名字重</span><span id="bam-val-name-weight" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_nameFontWeight}</span></div>
        <input id="bam-range-name-weight" type="range" min="100" max="900" step="10" value="${STYLE_DEFAULTS.style_nameFontWeight}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>

      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">颜色</div>
      <div style="margin-bottom:20px;">
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
          <input type="radio" name="bam-color-mode" value="global" checked style="accent-color:#4a6cf7;" />
          <span style="color:#ccc; font-size:13px;">全局统一色</span>
          <input id="bam-global-color-picker" type="color" value="${STYLE_DEFAULTS.style_globalTextColor}" style="width:28px; height:28px; border:none; background:none; cursor:pointer; padding:0; margin-left:auto;" />
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="radio" name="bam-color-mode" value="character" style="accent-color:#4a6cf7;" />
          <span style="color:#ccc; font-size:13px;">跟随角色主题色</span>
        </label>
        <div style="color:#555; font-size:11px; margin-top:6px; padding-left:24px;">旁白颜色始终跟随全局统一色</div>
      </div>
      <div style="display:flex; gap:12px; margin-bottom:10px; align-items:center;">
        <label style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
          <span style="color:#ccc; font-size:13px; flex-shrink:0;">旁白背景色</span>
          <input id="bam-narration-bg-color" type="color" value="${STYLE_DEFAULTS.style_narrationBgColor}" style="width:36px; height:30px; border:none; background:none; cursor:pointer; padding:0;" />
        </label>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白透明度</span><span id="bam-val-narration-bg-opacity" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationBgOpacity.toFixed(2)}</span></div>
          <input id="bam-range-narration-bg-opacity" type="range" min="0" max="0.4" step="0.01" value="${STYLE_DEFAULTS.style_narrationBgOpacity}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
        </div>
      </div>

      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">布局</div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">头像大小</span><span id="bam-val-avatar-size" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_avatarSize}px</span></div>
        <input id="bam-range-avatar-size" type="range" min="36" max="88" step="1" value="${STYLE_DEFAULTS.style_avatarSize}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="color:#ccc; font-size:13px; margin-bottom:6px;">头像形状</div>
        <div style="display:flex; gap:12px;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="radio" name="bam-avatar-shape" value="rounded" checked style="accent-color:#4a6cf7;" />
            <span style="color:#bbb; font-size:12px;">圆角矩形</span>
          </label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="radio" name="bam-avatar-shape" value="circle" style="accent-color:#4a6cf7;" />
            <span style="color:#bbb; font-size:12px;">纯圆形</span>
          </label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="radio" name="bam-avatar-shape" value="square" style="accent-color:#4a6cf7;" />
            <span style="color:#bbb; font-size:12px;">纯方形</span>
          </label>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白左侧留白</span><span id="bam-val-narration-indent" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationIndent}px</span></div>
        <input id="bam-range-narration-indent" type="range" min="0" max="120" step="2" value="${STYLE_DEFAULTS.style_narrationIndent}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白圆角</span><span id="bam-val-narration-border-radius" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationBorderRadius}px</span></div>
        <input id="bam-range-narration-border-radius" type="range" min="0" max="24" step="1" value="${STYLE_DEFAULTS.style_narrationBorderRadius}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白首行缩进</span><span id="bam-val-narration-text-indent" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationTextIndent}em</span></div>
        <input id="bam-range-narration-text-indent" type="range" min="0" max="4" step="0.5" value="${STYLE_DEFAULTS.style_narrationTextIndent}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白行距</span><span id="bam-val-narration-line-height" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationLineHeight}</span></div>
        <input id="bam-range-narration-line-height" type="range" min="1.2" max="3.0" step="0.05" value="${STYLE_DEFAULTS.style_narrationLineHeight}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">旁白右边距</span><span id="bam-val-narration-padding-right" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_narrationPaddingRight}px</span></div>
        <input id="bam-range-narration-padding-right" type="range" min="0" max="120" step="2" value="${STYLE_DEFAULTS.style_narrationPaddingRight}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">心里话尾符间距</span><span id="bam-val-thought-suffix-gap" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_thoughtSuffixGap}px</span></div>
        <input id="bam-range-thought-suffix-gap" type="range" min="0" max="24" step="1" value="${STYLE_DEFAULTS.style_thoughtSuffixGap}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>
      <div style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">心里话尾符上下偏移</span><span id="bam-val-thought-suffix-offset-y" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_thoughtSuffixOffsetY}px</span></div>
        <input id="bam-range-thought-suffix-offset-y" type="range" min="-24" max="24" step="1" value="${STYLE_DEFAULTS.style_thoughtSuffixOffsetY}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
      </div>

      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">字体</div>
      <div style="display:grid; gap:12px; margin-bottom:14px;">
        <label style="display:flex; flex-direction:column; gap:6px;">
          <span style="color:#ccc; font-size:13px;">旁白字体</span>
          <select id="bam-select-narration-font" style="background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.08); color:#e0e0e0; border-radius:8px; padding:8px 10px;"></select>
        </label>
        <label style="display:flex; flex-direction:column; gap:6px;">
          <span style="color:#ccc; font-size:13px;">台词字体</span>
          <select id="bam-select-dialogue-font" style="background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.08); color:#e0e0e0; border-radius:8px; padding:8px 10px;"></select>
        </label>
        <label style="display:flex; flex-direction:column; gap:6px;">
          <span style="color:#ccc; font-size:13px;">角色名字体</span>
          <select id="bam-select-name-font" style="background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.08); color:#e0e0e0; border-radius:8px; padding:8px 10px;"></select>
        </label>
      </div>
      <label style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        <span style="color:#ccc; font-size:13px;">远程字体配置 URL</span>
        <input id="bam-font-url-input" type="url" placeholder="https://example.com/fonts.json" value="${STYLE_DEFAULTS.style_fontConfigUrl}" style="background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.08); color:#e0e0e0; border-radius:8px; padding:8px 10px;" />
      </label>
      <div style="display:flex; justify-content:flex-end; margin-bottom:20px;">
        <button id="bam-btn-refresh-fonts" style="background:rgba(74,108,247,0.16); border:1px solid rgba(74,108,247,0.35); color:#b9c7ff; padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12px;">刷新字体列表</button>
      </div>

      <label style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        <span style="color:#ccc; font-size:13px;">在线 CSS 字体导入</span>
        <div style="display:flex; gap:8px;">
          <input id="bam-css-font-url-input" type="url" placeholder="https://fontsapi.xxx.com/.../result.css" style="flex:1; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.08); color:#e0e0e0; border-radius:8px; padding:8px 10px; min-width:0;" />
          <button id="bam-btn-import-css-font" style="background:rgba(74,108,247,0.16); border:1px solid rgba(74,108,247,0.35); color:#b9c7ff; padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12px; white-space:nowrap;">解析并导入</button>
        </div>
      </label>
      <div id="bam-css-font-sources" style="margin-bottom:16px; max-height:150px; overflow-y:auto;"></div>

      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <span style="color:#ccc; font-size:13px;">本地字体</span>
        <button id="bam-btn-upload-local-font" style="background:rgba(74,108,247,0.16); border:1px solid rgba(74,108,247,0.35); color:#b9c7ff; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:12px;">+ 上传字体文件</button>
        <input id="bam-local-font-input" type="file" accept="${LOCAL_FONT_ACCEPT}" style="display:none;" />
      </div>
      <div id="bam-local-font-list" style="margin-bottom:20px; max-height:150px; overflow-y:auto;"></div>

      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">存储优化</div>
      <div style="margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="bam-chk-compress-enabled" type="checkbox" checked style="accent-color:#4a6cf7;" />
          <span style="color:#ccc; font-size:13px;">自动压缩图片（存储前转为 WebP）</span>
        </label>
      </div>
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:#ccc; font-size:13px;">压缩质量</span><span id="bam-val-compress-quality" style="color:#888; font-size:12px;">${STYLE_DEFAULTS.style_imageCompressQuality.toFixed(2)}</span></div>
        <input id="bam-range-compress-quality" type="range" min="0.5" max="1.0" step="0.01" value="${STYLE_DEFAULTS.style_imageCompressQuality}" style="width:100%; accent-color:#4a6cf7; cursor:pointer;" />
        <div style="color:#555; font-size:11px; margin-top:4px;">质量 0.8 视觉几乎无损，体积可减少 30~60%。设为 1.0 则近似无损。</div>
      </div>

      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">Markdown 渲染</div>
      <div style="margin-bottom:20px;">
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
          <input type="radio" name="bam-md-mode" value="basic" checked style="accent-color:#4a6cf7;" />
          <span style="color:#ccc; font-size:13px;">基础（粗体 / 斜体 / 删除线）</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="radio" name="bam-md-mode" value="full" style="accent-color:#4a6cf7;" />
          <span style="color:#ccc; font-size:13px;">完整（全部语法）</span>
        </label>
      </div>

      <div style="display:flex; justify-content:center; gap:12px; margin-bottom:12px;">
        <button id="bam-btn-save-style" style="background:#4a6cf7; border:none; color:#fff; padding:8px 24px; border-radius:6px; cursor:pointer; font-size:13px; opacity:0.65;" disabled>保存样式</button>
        <button id="bam-btn-reset-style" style="background:rgba(255,255,255,0.06); border:none; color:#aaa; padding:8px 24px; border-radius:6px; cursor:pointer; font-size:13px;">恢复默认</button>
      </div>
      <div id="bam-style-save-tip" style="text-align:center; color:#555; font-size:11px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.06);">
        当前样式已保存；调整时只影响预览，点击保存后下次静态重渲染读取新值</div>
    </div>

    <div id="bam-tab-mood" style="display:none; flex-direction:column; flex:1; overflow-y:auto; padding:16px 20px;">
    </div>

    <div id="bam-tab-live2d" style="display:none; flex-direction:column; flex:1; overflow:hidden; padding:16px 20px; gap:12px;">
      <div style="padding:12px 14px; border-radius:12px; background:rgba(74,108,247,0.08); border:1px solid rgba(74,108,247,0.18); color:#aebfff; font-size:12px; line-height:1.6;">
        <div style="font-size:14px; font-weight:600; color:#d7defe; margin-bottom:4px;">Live2D 素材管理</div>
        <div>资源写入 <code style="color:#fff;">gfl-live2d-assets/assets</code>，但模型列表和当前启用状态按当前角色卡隔离；支持目录导入、压缩包导入/导出，并可查看已写入文件。</div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
        <button id="bam-btn-live2d-import-dir" style="background:rgba(74,108,247,0.16); border:1px solid rgba(74,108,247,0.35); color:#d5ddff; padding:9px 12px; border-radius:9px; cursor:pointer; font-size:12px;">导入目录</button>
        <button id="bam-btn-live2d-import-zip" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#ccc; padding:9px 12px; border-radius:9px; cursor:pointer; font-size:12px;">导入压缩包</button>
        <button id="bam-btn-live2d-export-zip" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#ccc; padding:9px 12px; border-radius:9px; cursor:pointer; font-size:12px;">导出压缩包</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button id="bam-btn-live2d-refresh" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#bbb; padding:7px 12px; border-radius:8px; cursor:pointer; font-size:12px;">刷新列表</button>
        <button id="bam-btn-live2d-clear" style="background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.22); color:#e99; padding:7px 12px; border-radius:8px; cursor:pointer; font-size:12px;">清空绑定</button>
        <span id="bam-live2d-status" style="flex:1; color:#666; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">尚未读取 Live2D 文件列表</span>
      </div>
      <div id="bam-live2d-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; min-height:120px; padding-right:2px;">
        <div style="text-align:center; color:#555; padding:30px 0; font-size:13px;">切到本页后会自动读取 Live2D 文件列表</div>
      </div>
    </div>
  </div>
  <input id="bam-import-input" type="file" accept=".json,.zip" style="display:none;" />
  <input id="bam-live2d-dir-input" type="file" accept=".json,.moc,.png,.jpg,.jpeg,.webp,.mtn,.exp" webkitdirectory directory multiple style="display:none;" />
  <input id="bam-live2d-zip-input" type="file" accept=".zip" style="display:none;" />`;
  }

  _avatarItemHTML(avatar, blobUrl, color, sourceInfo = '📁') {
    const sizeKB = (avatar.fileSize / 1024).toFixed(1);
    const displayName = avatar.displayName || avatar.alias;
    const safeName = escapeHtmlAttr(displayName);
    const safeImgSrc = blobUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const colorDot = color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle;"></span>` : '';
    return `
<div class="bam-avatar-item" data-name="${safeName}" style="
  display:flex; flex-direction:column; gap:0; margin-bottom:6px;
  background:rgba(255,255,255,0.03); border-radius:10px; overflow:hidden;
">
  <div style="display:flex; align-items:center; gap:12px; padding:10px 12px;">
    <img src="${safeImgSrc}" class="bam-avatar-thumb" data-preview-src="${safeImgSrc}" data-preview-title="${safeName}" style="width:44px; height:44px; border-radius:50%;
      object-fit:cover; flex-shrink:0; border:2px solid ${color || 'rgba(255,255,255,0.1)'}; cursor:pointer;" />
    <div style="flex:1; min-width:0;">
      <div style="color:#e0e0e0; font-size:14px; font-weight:500;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${colorDot}${safeName}</div>
      <div style="color:#666; font-size:11px; margin-top:2px;">${sourceInfo} ${sizeKB} KB · ${avatar.mimeType.split('/')[1].toUpperCase()}</div>
    </div>
    <div style="display:flex; gap:4px; flex-shrink:0;">
      <button class="bam-action-btn bam-btn-color" data-name="${safeName}" title="修改颜色" style="
        background:rgba(255,255,255,0.06); border:none; color:#888;
        width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:13px;">&#x1F3A8;</button>
      <button class="bam-action-btn bam-btn-replace" data-name="${safeName}" title="替换图片" style="
        background:rgba(255,255,255,0.06); border:none; color:#888;
        width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:13px;">&#x21BB;</button>
      <button class="bam-action-btn bam-btn-rename" data-name="${safeName}" title="重命名" style="
        background:rgba(255,255,255,0.06); border:none; color:#888;
        width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:13px;">&#x270E;</button>
      <button class="bam-action-btn bam-btn-delete" data-name="${safeName}" title="删除" style="
        background:rgba(255,80,80,0.1); border:none; color:#e55;
        width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:13px;">&times;</button>
      <button class="bam-action-btn bam-btn-mood-toggle" data-name="${safeName}" title="情绪差分" style="
        background:rgba(74,108,247,0.12); border:none; color:#8ba4f7;
        width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:11px;">▼</button>
    </div>
  </div>
  <div class="bam-mood-panel" data-name="${safeName}" style="display:none; padding:8px 12px 12px; border-top:1px solid rgba(255,255,255,0.04); max-height:40vh; overflow-y:auto; -webkit-overflow-scrolling:touch;"></div>
</div>`;
  }

  // -------------------- 事件绑定 --------------------

  _bindEvents() {
    const doc = this._getMainDocument();
    const $ = (s) => doc.querySelector(s);

    $('#bam-btn-close').addEventListener('click', () => this.close());

    // ---- Tab 切换 ----
    doc.querySelectorAll('.bam-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    // ---- 当前角色卡 / 全局分区切换 ----
    doc.querySelectorAll('input[name="bam-target-scope"]').forEach(radio => {
      radio.addEventListener('change', async () => {
        await this._refreshList();
        if (this.currentTab === 'live2d') await this._refreshLive2DList();
      });
    });

    // ---- 远程头像操作 ----
    $('#bam-btn-fetch-remote')?.addEventListener('click', async () => {
      const btn = doc.getElementById('bam-btn-fetch-remote');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '检查中...';

      const charId = this._getActiveCharId();
      let fetched = 0, failed = 0;
      const compOpts = await getCompressOptions(this.db);

      // 收集所有需要拉取的记录
      const tasks = [];

      const avatars = await this.db.list(charId);
      for (const av of avatars) {
        const record = await this.db.get(charId, av.displayName);
        if (record && record.sourceUrl && record.sourceUrl !== 'null' && !record.imageBlob) {
          tasks.push({ type: 'avatar', name: av.displayName, record });
        }
      }

      const allMoods = await new Promise((resolve, reject) => {
        const req = this.db.db.transaction(STORE_MOOD_AVATARS, 'readonly').objectStore(STORE_MOOD_AVATARS).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('查询失败'));
      });
      for (const r of allMoods.filter(r => r.charId === charId && r.sourceUrl && r.sourceUrl !== 'null' && !r.imageBlob)) {
        tasks.push({ type: 'mood', record: r });
      }

      if (!tasks.length) {
        btn.textContent = originalText;
        btn.disabled = false;
        alert('没有需要拉取的远程头像');
        return;
      }

      // 逐个拉取并更新进度
      for (let i = 0; i < tasks.length; i++) {
        btn.textContent = `拉取中 ${i + 1}/${tasks.length}...`;
        const task = tasks[i];
        try {
          const resp = await fetch(task.record.sourceUrl);
          if (!resp.ok) { failed++; continue; }
          let blob = await resp.blob();
          blob = await compressImage(blob, compOpts);
          if (task.type === 'avatar') {
            await this.db.update(charId, task.name, blob);
          } else {
            task.record.imageBlob = blob;
            task.record.fileSize = blob.size;
            task.record.mimeType = blob.type || task.record.mimeType;
            task.record.updatedAt = Date.now();
            await this.db._put(STORE_MOOD_AVATARS, task.record);
          }
          fetched++;
        } catch (_) { failed++; }
      }

      btn.textContent = originalText;
      btn.disabled = false;
      alert(`远程头像拉取完成: ${fetched} 张成功${failed ? ', ' + failed + ' 张失败' : ''}`);
      await this._refreshList();
    });
    $('#bam-btn-clear-remote-cache')?.addEventListener('click', async () => {
      if (!confirm('确定清除所有远程头像的本地缓存？下次渲染时会重新拉取。')) return;
      const charId = this._getActiveCharId();
      let cleared = 0;

      // 主头像
      const allAvatars = await new Promise((resolve, reject) => {
        const req = this.db.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('查询失败'));
      });
      const prefix = charId + CHAR_ID_SEPARATOR;
      for (const r of allAvatars.filter(r => r.alias.startsWith(prefix) && r.sourceUrl && r.sourceUrl !== 'null')) {
        r.imageBlob = null;
        r.fileSize = 0;
        r.updatedAt = Date.now();
        await this.db._put(STORE_AVATARS, r);
        cleared++;
      }

      // 情绪差分头像
      const allMoods = await new Promise((resolve, reject) => {
        const req = this.db.db.transaction(STORE_MOOD_AVATARS, 'readonly').objectStore(STORE_MOOD_AVATARS).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('查询失败'));
      });
      for (const r of allMoods.filter(r => r.charId === charId && r.sourceUrl && r.sourceUrl !== 'null')) {
        r.imageBlob = null;
        r.fileSize = 0;
        r.updatedAt = Date.now();
        await this.db._put(STORE_MOOD_AVATARS, r);
        cleared++;
      }

      alert(`已清除 ${cleared} 张远程头像缓存`);
      this.db._blobUrlCache.clear();
      await this._refreshList();
    });

    // ---- CG 图片库管理 ----
    $('#bam-cg-header')?.addEventListener('click', () => {
      const body = doc.getElementById('bam-cg-body');
      const toggle = doc.getElementById('bam-cg-toggle');
      if (!body) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? 'block' : 'none';
      if (toggle) toggle.textContent = collapsed ? '▼' : '▶';
      if (collapsed) this._renderCgGroupList();
    });
    $('#bam-btn-add-cg-group')?.addEventListener('click', async () => {
      const groupName = prompt('CG 组名（如"天之音"）:');
      if (!groupName) return;
      // prompt 不支持多行输入，用自定义弹窗
      this._showTextareaDialog({
        title: '粘贴图片链接（每行一个）或留空后手动上传',
        placeholder: '留空 = 之后用「上传图片」按钮手动添加\n\n或粘贴远程链接：\nhttps://files.catbox.moe/xxx.png\nhttps://files.catbox.moe/yyy.png',
        onConfirm: async (albumUrl) => {
          try {
            await this.db.addCgGroup(groupName.trim(), albumUrl || '', this._getActiveCharId());
            if (albumUrl.trim()) {
              try { await ensureCgGroupIndex(this.db, groupName.trim()); } catch (_) {}
            }
            this._renderCgGroupList();
          } catch (err) { alert('添加失败: ' + err.message); }
        }
      });
    });
    $('#bam-btn-clear-all-cg')?.addEventListener('click', async () => {
      if (!confirm('确定清除所有 CG 图片缓存？')) return;
      await this.db.clearAllCgCache();
      this._renderCgGroupList();
      alert('CG 缓存已全部清除');
    });

    // ---- 缩略图点击大图预览（头像 + 情绪差分 + CG 统一处理）----
    const container = doc.getElementById('bam-container');
    container?.addEventListener('click', (e) => {
      const thumb = e.target.closest('.bam-avatar-thumb, .bam-cg-thumb');
      if (!thumb) return;
      const src = thumb.dataset.previewSrc;
      if (!src || src.startsWith('data:')) return;
      e.stopPropagation();
      this._openImagePreview(src, thumb.dataset.previewTitle || '');
    });

    // ---- 头像管理 Tab 事件 ----

    $('#bam-btn-add-remote-avatar')?.addEventListener('click', async () => {
      const name = prompt('角色名（用于渲染时匹配）:');
      if (!name || !name.trim()) return;
      const url = prompt('远程图片 URL（如 https://files.catbox.moe/xxx.png）:');
      if (!url || !url.trim()) return;
      const charId = this._getActiveCharId();
      try {
        const existing = await this.db.get(charId, name.trim());
        if (existing) {
          await this.db.update(charId, name.trim(), existing.imageBlob, { sourceUrl: url.trim() });
        } else {
          await this.db.add(charId, name.trim(), null, { sourceUrl: url.trim(), mimeType: 'image/webp' });
        }
        await this._refreshList();
      } catch (err) { alert('添加失败: ' + err.message); }
    });

    $('#bam-upload-area').addEventListener('click', () => $('#bam-file-input').click());

    const uploadArea = $('#bam-upload-area');
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = 'rgba(74,108,247,0.5)';
      uploadArea.style.background = 'rgba(74,108,247,0.05)';
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.style.borderColor = 'rgba(255,255,255,0.12)';
      uploadArea.style.background = 'transparent';
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = 'rgba(255,255,255,0.12)';
      uploadArea.style.background = 'transparent';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) this._handleFileSelected(file);
    });

    $('#bam-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this._handleFileSelected(file);
      e.target.value = '';
    });

    $('#bam-btn-cancel-upload').addEventListener('click', () => this._hideAliasInput());
    $('#bam-btn-confirm-upload').addEventListener('click', () => this._confirmUpload());
    $('#bam-alias-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._confirmUpload(); });

    // 颜色预设圆点点击
    this.selectedColor = '#58a6ff';
    doc.querySelectorAll('.bam-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        this.selectedColor = dot.dataset.color;
        $('#bam-color-input').value = dot.dataset.color;
        doc.querySelectorAll('.bam-color-dot').forEach(d => d.style.borderColor = 'transparent');
        dot.style.borderColor = '#fff';
      });
    });
    // 自定义颜色输入同步
    $('#bam-color-input').addEventListener('input', (e) => {
      this.selectedColor = e.target.value;
      doc.querySelectorAll('.bam-color-dot').forEach(d => d.style.borderColor = 'transparent');
    });

    $('#bam-btn-export').addEventListener('click', async () => {
      const exportBtn = $('#bam-btn-export');
      const origExportText = exportBtn ? exportBtn.textContent : '';
      if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '导出中...'; }
      try {
        await this.db.exportCharacterDataToFile(this._getActiveCharId(), (msg) => {
          if (exportBtn) exportBtn.textContent = msg;
        });
      } catch (err) { alert('导出失败: ' + err.message); }
      finally {
        if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = origExportText; }
      }
    });

    $('#bam-btn-live2d-import-dir')?.addEventListener('click', () => $('#bam-live2d-dir-input')?.click());
    $('#bam-btn-live2d-import-zip')?.addEventListener('click', () => $('#bam-live2d-zip-input')?.click());
    $('#bam-btn-live2d-export-zip')?.addEventListener('click', () => this._handleLive2DExportAll());
    $('#bam-btn-live2d-refresh')?.addEventListener('click', () => this._refreshLive2DList());
    $('#bam-btn-live2d-clear')?.addEventListener('click', () => this._handleLive2DClearBindings());

    $('#bam-live2d-dir-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const charId = this._getActiveCharId();
      await this._handleLive2DImport(() => this.db.importLive2DFromFileList(files, (msg) => this._setLive2DStatus(msg), charId), '目录导入');
      e.target.value = '';
    });

    $('#bam-live2d-zip-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const charId = this._getActiveCharId();
      await this._handleLive2DImport(() => this.db.importLive2DFromZip(file, (msg) => this._setLive2DStatus(msg), charId), '压缩包导入');
      e.target.value = '';
    });

    $('#bam-live2d-list')?.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-live2d-action]');
      if (!action) return;
      const dir = action.dataset.dir;
      if (!dir) return;
      const type = action.dataset.live2dAction;
      if (type === 'toggle') this._toggleLive2DFileList(dir);
      else if (type === 'export') await this._handleLive2DExport(dir);
      else if (type === 'delete') await this._handleLive2DDelete(dir);
      else if (type === 'activate') await this._handleLive2DActivate(dir);
    });

    $('#bam-btn-import').addEventListener('click', () => $('#bam-import-input').click());
    $('#bam-import-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const importBtn = $('#bam-btn-import');
      const origText = importBtn ? importBtn.textContent : '';
      if (importBtn) { importBtn.disabled = true; importBtn.textContent = '导入中...'; }
      try {
        const result = await this.db.importFromFile(file, this._getActiveCharId(), (msg) => {
          if (importBtn) importBtn.textContent = msg;
        });
        let msg = `导入完成: 成功 ${result.imported} 项`;
        if (result.skipped) msg += `, 跳过 ${result.skipped} 项`;
        if (result.errors?.length) msg += `\n错误: ${result.errors.join(', ')}`;
        alert(msg);
        await this._refreshList();
        this._requestAvatarAssetPreviewRefresh();
      } catch (err) { alert('导入失败: ' + err.message); }
      finally {
        if (importBtn) { importBtn.disabled = false; importBtn.textContent = origText; }
        e.target.value = '';
      }
    });

    $('#bam-avatar-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.bam-action-btn');
      if (!btn) return;
      const name = btn.dataset.name;
      if (btn.classList.contains('bam-btn-delete')) this._handleDelete(name);
      else if (btn.classList.contains('bam-btn-rename')) this._handleRename(name);
      else if (btn.classList.contains('bam-btn-replace')) this._handleReplace(name);
      else if (btn.classList.contains('bam-btn-color')) this._handleChangeColor(name);
      else if (btn.classList.contains('bam-btn-mood-toggle')) this._handleMoodToggle(name);
    });

    $('#bam-avatar-list').addEventListener('click', (e) => {
      const moodBtn = e.target.closest('.bam-mood-action');
      if (!moodBtn) return;
      const name = moodBtn.dataset.name;
      const moodId = moodBtn.dataset.moodId;
      if (moodBtn.classList.contains('bam-mood-upload')) this._handleMoodUpload(name, moodId);
      else if (moodBtn.classList.contains('bam-mood-delete')) this._handleMoodDelete(name, moodId);
      else if (moodBtn.classList.contains('bam-mood-remote')) this._handleMoodRemoteUrl(name, moodId);
    });

    // ---- 正文美化 Tab 事件 ----
    const applyLiveStylePreview = () => {
      this._applyBubblePreviewStyles().catch((err) => {
        console.warn('Bubble 预览样式应用失败:', err);
      });
    };
    const markStyleDirty = () => {
      if (!this._styleDraftLoaded) this._styleDraftLoaded = true;
      this._setStyleDraftDirty(true);
    };
    const previewAndMarkDirty = () => {
      applyLiveStylePreview();
      markStyleDirty();
    };
    const bindRangeSetting = ({ inputId, valueId, formatter }) => {
      const inputEl = $(inputId);
      const valueEl = $(valueId);
      if (!inputEl || !valueEl) return;
      const syncDisplay = (value) => {
        valueEl.textContent = formatter(value);
      };
      inputEl.addEventListener('input', (e) => {
        syncDisplay(e.target.value);
        previewAndMarkDirty();
      });
      inputEl.addEventListener('change', (e) => {
        syncDisplay(e.target.value);
        previewAndMarkDirty();
      });
    };

    bindRangeSetting({ inputId: '#bam-range-dialogue-font', valueId: '#bam-val-dialogue-font', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-narration-font', valueId: '#bam-val-narration-font', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-dialogue-spacing', valueId: '#bam-val-dialogue-spacing', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-dialogue-weight', valueId: '#bam-val-dialogue-weight', formatter: (v) => `${v}` });
    bindRangeSetting({ inputId: '#bam-range-narration-weight', valueId: '#bam-val-narration-weight', formatter: (v) => `${v}` });
    bindRangeSetting({ inputId: '#bam-range-name-weight', valueId: '#bam-val-name-weight', formatter: (v) => `${v}` });
    bindRangeSetting({ inputId: '#bam-range-narration-bg-opacity', valueId: '#bam-val-narration-bg-opacity', formatter: (v) => Number.parseFloat(v).toFixed(2) });
    bindRangeSetting({ inputId: '#bam-range-avatar-size', valueId: '#bam-val-avatar-size', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-narration-indent', valueId: '#bam-val-narration-indent', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-narration-border-radius', valueId: '#bam-val-narration-border-radius', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-thought-suffix-gap', valueId: '#bam-val-thought-suffix-gap', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-thought-suffix-offset-y', valueId: '#bam-val-thought-suffix-offset-y', formatter: (v) => `${v}px` });
    // v7.0
    bindRangeSetting({ inputId: '#bam-range-narration-text-indent', valueId: '#bam-val-narration-text-indent', formatter: (v) => `${v}em` });
    bindRangeSetting({ inputId: '#bam-range-narration-line-height', valueId: '#bam-val-narration-line-height', formatter: (v) => `${v}` });
    bindRangeSetting({ inputId: '#bam-range-narration-padding-right', valueId: '#bam-val-narration-padding-right', formatter: (v) => `${v}px` });
    bindRangeSetting({ inputId: '#bam-range-compress-quality', valueId: '#bam-val-compress-quality', formatter: (v) => Number.parseFloat(v).toFixed(2) });
    $('#bam-chk-compress-enabled')?.addEventListener('change', () => { markStyleDirty(); });

    doc.querySelectorAll('input[name="bam-avatar-shape"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        previewAndMarkDirty();
      });
    });

    doc.querySelectorAll('input[name="bam-color-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        previewAndMarkDirty();
      });
    });

    ['#bam-global-color-picker', '#bam-narration-bg-color'].forEach((selector) => {
      $(selector)?.addEventListener('input', () => {
        previewAndMarkDirty();
      });
      $(selector)?.addEventListener('change', () => {
        previewAndMarkDirty();
      });
    });

    ['#bam-select-narration-font', '#bam-select-dialogue-font', '#bam-select-name-font'].forEach((selector) => {
      $(selector)?.addEventListener('change', () => {
        previewAndMarkDirty();
      });
    });

    const fontUrlInput = $('#bam-font-url-input');
    fontUrlInput?.addEventListener('input', () => {
      markStyleDirty();
    });
    fontUrlInput?.addEventListener('change', () => {
      markStyleDirty();
    });
    $('#bam-btn-refresh-fonts')?.addEventListener('click', async () => {
      try {
        await this._refreshFontSelectors({ forceRemote: true, silent: false });
        await this._applyBubblePreviewStyles();
        markStyleDirty();
      } catch (err) {
        console.warn('刷新远程字体失败:', err);
        alert(`字体列表刷新失败：${err.message}`);
      }
    });

    // ---- CSS 字体导入 ----
    $('#bam-btn-import-css-font')?.addEventListener('click', async () => {
      const urlInput = doc.getElementById('bam-css-font-url-input');
      const cssUrl = urlInput?.value?.trim();
      if (!cssUrl) { alert('请输入 CSS URL'); return; }
      const btn = doc.getElementById('bam-btn-import-css-font');
      const originalText = btn.textContent;
      btn.textContent = '解析中...';
      btn.disabled = true;
      try {
        const result = await this._parseCssFontFaces(cssUrl);
        if (!result.families.length) { alert('未在 CSS 中找到任何 @font-face 声明'); return; }
        await this.db.addCssFontSource(cssUrl, result.families);
        urlInput.value = '';
        await this._renderCssFontSources();
        await this._refreshFontSelectors({ forceRemote: false, silent: true });
        previewAndMarkDirty();
        alert(`成功导入 ${result.families.length} 个字体族：${result.families.join('、')}`);
      } catch (err) {
        alert(`CSS 字体导入失败：${err.message}`);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
    doc.getElementById('bam-css-font-sources')?.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.bam-css-font-delete');
      if (!delBtn) return;
      const url = delBtn.dataset.url;
      if (!confirm(`确定删除此 CSS 字体源？`)) return;
      await this.db.deleteCssFontSource(url);
      await this._renderCssFontSources();
      await this._refreshFontSelectors({ forceRemote: false, silent: true });
      previewAndMarkDirty();
    });

    // ---- 本地字体上传 ----
    const fontUploadBtn = $('#bam-btn-upload-local-font');
    fontUploadBtn?.addEventListener('click', () => {
      doc.getElementById('bam-local-font-input')?.click();
    });
    $('#bam-local-font-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      if (file.size > LOCAL_FONT_MAX_SIZE) { alert(`字体文件不能超过 ${LOCAL_FONT_MAX_SIZE / 1024 / 1024}MB`); return; }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!FONT_EXT_FORMAT_MAP[ext]) { alert('不支持的字体格式，请选择 .woff2 / .woff / .ttf / .otf'); return; }
      const family = file.name.replace(/\.[^.]+$/, '').trim();
      if (!family) { alert('无法从文件名提取字体名称'); return; }
      const existing = await this.db.getLocalFont(family);
      if (existing && !confirm(`已存在同名字体「${family}」，是否替换？`)) return;
      const origText = fontUploadBtn ? fontUploadBtn.textContent : '';
      if (fontUploadBtn) { fontUploadBtn.disabled = true; fontUploadBtn.textContent = '上传中...'; }
      try {
        await this.db.addLocalFont(family, file, { fileName: file.name, mimeType: FONT_EXT_MIME_MAP[ext] });
        await this._renderLocalFontList();
        await this._refreshFontSelectors({ forceRemote: false, silent: true });
        previewAndMarkDirty();
      } catch (err) { alert('字体上传失败：' + err.message); }
      finally { if (fontUploadBtn) { fontUploadBtn.disabled = false; fontUploadBtn.textContent = origText; } }
    });
    doc.getElementById('bam-local-font-list')?.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.bam-local-font-delete');
      if (!delBtn) return;
      const family = delBtn.dataset.family;
      if (!confirm(`确定删除本地字体「${family}」？`)) return;
      try {
        await this.db.deleteLocalFont(family);
        await this._renderLocalFontList();
        await this._refreshFontSelectors({ forceRemote: false, silent: true });
        previewAndMarkDirty();
      } catch (err) { alert('删除失败：' + err.message); }
    });

    doc.querySelectorAll('input[name="bam-md-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        markStyleDirty();
      });
    });

    $('#bam-btn-save-style')?.addEventListener('click', async () => {
      await this._saveCurrentStyleSettings();
    });
    $('#bam-btn-reset-style').addEventListener('click', () => this._resetStyleDefaults());
  }

  // -------------------- CSS 字体解析 --------------------

  async _parseCssFontFaces(cssUrl) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetch(cssUrl, { method: 'GET', cache: 'no-store', signal: controller?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cssText = await response.text();
      const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
      const familyRegex = /font-family\s*:\s*['"]?([^'";]+)['"]?\s*;/i;
      const families = new Set();
      let match;
      while ((match = fontFaceRegex.exec(cssText)) !== null) {
        const familyMatch = familyRegex.exec(match[1]);
        if (familyMatch) families.add(familyMatch[1].trim());
      }
      return { url: cssUrl, families: Array.from(families) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // -------------------- 本地字体列表渲染 --------------------

  async _renderLocalFontList() {
    const doc = this._getMainDocument();
    const container = doc.getElementById('bam-local-font-list');
    if (!container) return;
    try {
      const fonts = await this.db.listLocalFonts();
      if (!fonts.length) {
        container.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; padding:6px 0;">暂无本地字体</div>';
        return;
      }
      container.innerHTML = fonts.map(f => {
        const sizeKB = (f.fileSize / 1024).toFixed(1);
        const safeFamily = escapeHtmlAttr(f.family);
        return `<div style="display:flex; align-items:center; gap:8px; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px; margin-bottom:4px;">
          <span style="color:#ccc; font-size:12px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeFamily}">${safeFamily}</span>
          <span style="color:#666; font-size:11px; flex-shrink:0;">${sizeKB} KB</span>
          <button class="bam-local-font-delete" data-family="${safeFamily}" style="background:rgba(255,80,80,0.1); border:none; color:#e55; width:22px; height:22px; border-radius:4px; cursor:pointer; font-size:12px; flex-shrink:0; line-height:1;">&times;</button>
        </div>`;
      }).join('');
    } catch (_) {
      container.innerHTML = '';
    }
  }

  // -------------------- CSS 字体源列表渲染 --------------------

  async _renderCssFontSources() {
    const doc = this._getMainDocument();
    const container = doc.getElementById('bam-css-font-sources');
    if (!container) return;
    try {
      const sources = await this.db.getCssFontSources();
      if (!sources.length) {
        container.innerHTML = '';
        return;
      }
      container.innerHTML = sources.map(src => {
        const safeUrl = escapeHtmlAttr(src.url);
        const familyText = (src.families || []).join('、') || '未知';
        return `<div style="display:flex; align-items:center; gap:8px; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px; margin-bottom:4px;">
          <div style="flex:1; min-width:0; overflow:hidden;">
            <div style="color:#ccc; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeUrl}">${safeUrl}</div>
            <div style="color:#888; font-size:10px; margin-top:2px;">字体族：${escapeHtmlAttr(familyText)}</div>
          </div>
          <button class="bam-css-font-delete" data-url="${safeUrl}" style="background:rgba(255,80,80,0.1); border:none; color:#e55; width:22px; height:22px; border-radius:4px; cursor:pointer; font-size:12px; flex-shrink:0; line-height:1;">&times;</button>
        </div>`;
      }).join('');
    } catch (_) {
      container.innerHTML = '';
    }
  }

  // -------------------- 文件处理 --------------------

  _handleFileSelected(file) {
    if (file.size > 2 * 1024 * 1024) { alert('图片不能超过 2MB'); return; }
    if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
    this.pendingFile = file;
    const doc = this._getMainDocument();
    const reader = new FileReader();
    reader.onload = (e) => { doc.getElementById('bam-preview-img').src = e.target.result; };
    reader.readAsDataURL(file);
    const suggested = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '').toLowerCase().slice(0, 20);
    doc.getElementById('bam-alias-input').value = suggested;
    this._showAliasInput();
  }

  _showAliasInput() {
    const doc = this._getMainDocument();
    doc.getElementById('bam-alias-input-area').style.display = 'block';
    doc.getElementById('bam-alias-input').focus();
  }

  _hideAliasInput() {
    const doc = this._getMainDocument();
    doc.getElementById('bam-alias-input-area').style.display = 'none';
    this.pendingFile = null;
  }

  async _confirmUpload() {
    if (!this.pendingFile) return;
    const doc = this._getMainDocument();
    const name = doc.getElementById('bam-alias-input').value.trim();
    if (!name) { alert('请输入角色名'); return; }
    if (name.includes(CHAR_ID_SEPARATOR)) { alert('角色名不能包含连续双下划线'); return; }
    const color = this.selectedColor || '#58a6ff';
    const charId = this._getActiveCharId();
    const confirmBtn = doc.getElementById('bam-btn-confirm-upload');
    const origText = confirmBtn ? confirmBtn.textContent : '确认添加';
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '处理中...'; }
    try {
      const meta = await this._getImageMeta(this.pendingFile);
      const compOpts = await getCompressOptions(this.db);
      const blob = await compressImage(this.pendingFile, compOpts);
      await this.db.add(charId, name, blob, meta);
      await this.db.setConfig(buildColorConfigKey(charId, name), color);
      this._hideAliasInput();
      await this._refreshList();
      this._requestAvatarAssetPreviewRefresh();
    } catch (err) {
      if (err.message.includes('已存在')) {
        if (confirm(`角色名 "${name}" 已存在，是否替换图片和颜色？`)) {
          try {
            const meta = await this._getImageMeta(this.pendingFile);
            const compOpts2 = await getCompressOptions(this.db);
            const rBlob = await compressImage(this.pendingFile, compOpts2);
            await this.db.update(charId, name, rBlob, meta);
            await this.db.setConfig(buildColorConfigKey(charId, name), color);
            this._hideAliasInput();
            await this._refreshList();
            this._requestAvatarAssetPreviewRefresh();
          } catch (e2) { alert('替换失败: ' + e2.message); }
        }
      } else { alert('添加失败: ' + err.message); }
    } finally {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = origText; }
    }
  }

  _getImageMeta(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { resolve({ fileName: file.name, width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.onerror = () => { resolve({ fileName: file.name, width: 0, height: 0 }); };
      img.src = URL.createObjectURL(file);
    });
  }

  // -------------------- 列表操作 --------------------

  async _handleDelete(name) {
    if (!confirm(`确定删除头像 "${name}" 及其所有情绪差分头像吗？`)) return;
    const charId = this._getActiveCharId();
    try {
      // 尝试用标准 key 删除
      await this.db.delete(charId, name);
      // 同时尝试直接用 alias 删除（兼容旧版脏数据 key 格式不一致的情况）
      try {
        const prefix = String(charId || GLOBAL_CHAR_ID) + CHAR_ID_SEPARATOR;
        const allAvatars = await new Promise((resolve, reject) => {
          const req = this.db.db.transaction(STORE_AVATARS, 'readonly').objectStore(STORE_AVATARS).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(new Error('查询失败'));
        });
        for (const r of allAvatars) {
          if (r.alias.startsWith(prefix) && extractDisplayName(r.alias, charId) === name) {
            await new Promise((resolve, reject) => {
              const tx = this.db.db.transaction(STORE_AVATARS, 'readwrite');
              const req = tx.objectStore(STORE_AVATARS).delete(r.alias);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(new Error('删除失败'));
            });
          }
        }
      } catch (_) {}
      await this.db.deleteAllMoodAvatars(charId, name);
      try { await this.db.setConfig(buildColorConfigKey(charId, name), null); } catch (_) { /* ignore */ }
      if (this._expandedMoodName === name) this._expandedMoodName = null;
      await this._refreshList();
      this._requestAvatarAssetPreviewRefresh();
    }
    catch (err) { alert('删除失败: ' + err.message); }
  }

  async _handleChangeColor(name) {
    const charId = this._getActiveCharId();
    const currentColor = await this.db.getConfig(buildColorConfigKey(charId, name), '#58a6ff');
    this._openMobileColorDialog({
      title: `角色主题色 · ${name}`,
      initialValue: currentColor || '#58a6ff',
      onConfirm: async (nextColor) => {
        await this.db.setConfig(buildColorConfigKey(charId, name), nextColor);
        await this._refreshList();
        this._requestAvatarAssetPreviewRefresh();
      }
    });
  }

  async _handleRename(name) {
    const newName = prompt(`将 "${name}" 重命名为:`, name);
    if (!newName || newName.trim().toLowerCase() === name) return;
    try {
      await this.db.rename(this._getActiveCharId(), name, newName.trim());
      await this._refreshList();
      this._requestAvatarAssetPreviewRefresh();
    }
    catch (err) { alert('重命名失败: ' + err.message); }
  }

  async _handleReplace(name) {
    const doc = this._getMainDocument();
    const charId = this._getActiveCharId();
    const replaceBtn = doc.querySelector(`.bam-btn-replace[data-name="${name}"]`);
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { alert('图片不能超过 2MB'); return; }
      const origText = replaceBtn ? replaceBtn.textContent : '';
      if (replaceBtn) { replaceBtn.disabled = true; replaceBtn.textContent = '处理中...'; }
      try {
        const meta = await this._getImageMeta(file);
        const compOpts = await getCompressOptions(this.db);
        const blob = await compressImage(file, compOpts);
        await this.db.update(charId, name, blob, meta);
        await this._refreshList();
        this._requestAvatarAssetPreviewRefresh();
      } catch (err) {
        alert('替换失败: ' + err.message);
        if (replaceBtn) { replaceBtn.disabled = false; replaceBtn.textContent = origText; }
      }
    };
    input.click();
  }

  _getActiveCharId() {
    const doc = this._getMainDocument();
    const radio = doc.querySelector('input[name="bam-target-scope"]:checked');
    if (radio && radio.value === 'global') return GLOBAL_CHAR_ID;
    return this._charId;
  }

  async _refreshList() {
    const doc = this._getMainDocument();
    const listEl = doc.getElementById('bam-avatar-list');
    const statsEl = doc.getElementById('bam-stats');
    const charNameEl = doc.getElementById('bam-char-name');
    const charId = this._getActiveCharId();

    if (charNameEl) {
      charNameEl.textContent = charId === GLOBAL_CHAR_ID
        ? '⚠ 全局分区'
        : `${this._charName}`;
    }

    const avatars = await this.db.list(charId);
    const stats = await this.db.getStats(charId);
    statsEl.textContent = `已存储: ${stats.count} 张 | 总计: ${(stats.totalSize / 1024).toFixed(1)} KB`;
    if (avatars.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;color:#555;padding:30px 0;font-size:13px;">还没有头像，点击上方区域添加</div>';
      return;
    }
    let html = '';
    for (const avatar of avatars) {
      const record = await this.db.get(charId, avatar.displayName);
      const blobUrl = await this.db.getBlobUrl(charId, avatar.displayName);
      const color = await this.db.getConfig(buildColorConfigKey(charId, avatar.displayName), null);
      const sourceInfo = record?.sourceUrl && record.sourceUrl !== 'null'
        ? (record.imageBlob ? '<span style="color:#58a6ff;font-size:9px;">远程✓</span>' : '<span style="color:#eab308;font-size:9px;">远程⏳</span>')
        : '<span style="color:#7ee787;font-size:9px;">本地</span>';
      html += this._avatarItemHTML(avatar, blobUrl, color, sourceInfo);
    }
    listEl.innerHTML = html;

    if (this._expandedMoodName) {
      await this._renderMoodPanel(this._expandedMoodName);
    }
    this._renderCgGroupList();
  }

  // -------------------- CG 图片库面板 --------------------

  async _renderCgGroupList() {
    const doc = this._getMainDocument();
    const listEl = doc.getElementById('bam-cg-group-list');
    if (!listEl) return;
    const charId = this._getActiveCharId();
    try {
      const groups = await this.db.listCgGroups(charId);
      if (!groups.length) {
        listEl.innerHTML = '<div style="color:#555;font-size:12px;text-align:center;padding:12px 0;">暂无 CG 组</div>';
        return;
      }
      let html = '';
      for (const g of groups) {
        const cached = await this.db.getCgGroupCacheStats(g.group);
        const urls = g.imageUrls || [];
        const total = g.count || urls.length;
        const statusText = total > 0
          ? `${cached}/${total} 张已缓存`
          : '⏳ 未解析';
        const safeGroup = escapeHtmlAttr(g.group);

        // 构建图片清单：缩略图 + 组名#序号 → 来源
        let imageListHtml = '';
        if (urls.length > 0) {
          for (let i = 0; i < urls.length; i++) {
            const isLocal = urls[i].startsWith('local://');
            const shortName = isLocal ? urls[i].replace('local://', '') : (urls[i].split('/').pop() || urls[i]);
            const sourceTag = isLocal ? '<span style="color:#7ee787;font-size:9px;flex-shrink:0;">本地</span>' : '<span style="color:#58a6ff;font-size:9px;flex-shrink:0;">远程</span>';
            const cgCache = await this.db.getCgImage(g.group, i + 1);
            const thumbSrc = (cgCache && cgCache.imageBlob) ? URL.createObjectURL(cgCache.imageBlob) : null;
            const thumbHtml = thumbSrc
              ? `<img src="${thumbSrc}" class="bam-cg-thumb" data-preview-src="${thumbSrc}" data-preview-title="${safeGroup}#${i + 1}" style="width:28px;height:28px;border-radius:3px;object-fit:cover;flex-shrink:0;border:1px solid rgba(255,255,255,0.08);cursor:pointer;" />`
              : `<div style="width:28px;height:28px;border-radius:3px;background:rgba(255,255,255,0.04);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;">—</div>`;
            const deleteBtn = isLocal ? `<button class="bam-cg-delete-single" data-group="${safeGroup}" data-index="${i + 1}" style="background:none;border:none;color:#e55;cursor:pointer;font-size:12px;padding:0 2px;flex-shrink:0;line-height:1;">&times;</button>` : '';
            imageListHtml += `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px;">
              ${thumbHtml}
              <span style="color:#b9c7ff;min-width:60px;flex-shrink:0;font-family:monospace;">${safeGroup}#${i + 1}</span>
              ${sourceTag}
              <span style="color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtmlAttr(urls[i])}">${escapeHtmlAttr(shortName)}</span>
              ${deleteBtn}
            </div>`;
          }
        } else {
          const lineCount = (g.albumUrl || '').split(/[\n\r]+/).filter(l => l.trim()).length;
          imageListHtml = `<div style="color:#666;font-size:10px;padding:4px 0;">点击「预加载整组」解析清单（${lineCount > 1 ? lineCount + ' 张图片' : '1 个来源'}）</div>`;
        }

        html += `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="color:#ccc;font-size:12px;font-weight:600;">📁 ${safeGroup}</span>
            <span style="color:#888;font-size:11px;">${statusText}</span>
          </div>
          <div class="bam-cg-image-list" data-group="${safeGroup}" style="max-height:120px;overflow-y:auto;margin-bottom:6px;padding:2px 4px;background:rgba(0,0,0,0.15);border-radius:4px;">
            ${imageListHtml}
          </div>
          <div style="display:flex;gap:6px;">
            <button class="bam-cg-upload" data-group="${safeGroup}" style="background:rgba(74,108,247,0.12);border:1px solid rgba(74,108,247,0.25);color:#b9c7ff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;">上传图片</button>
            <button class="bam-cg-preload" data-group="${safeGroup}" style="background:rgba(74,108,247,0.12);border:1px solid rgba(74,108,247,0.25);color:#b9c7ff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;">预加载整组</button>
            <button class="bam-cg-clear" data-group="${safeGroup}" style="background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2);color:#e88;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;">清除缓存</button>
            <button class="bam-cg-delete" data-group="${safeGroup}" style="background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2);color:#e88;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;">删除</button>
          </div>
        </div>`;
      }
      listEl.innerHTML = html;

      // 绑定 CG 操作事件
      listEl.querySelectorAll('.bam-cg-upload').forEach(btn => {
        btn.addEventListener('click', () => {
          const group = btn.dataset.group;
          const input = doc.createElement('input');
          input.type = 'file';
          input.accept = 'image/jpeg,image/png,image/gif,image/webp';
          input.multiple = true;
          input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '处理中 0/' + files.length + '...';
            const compOpts = await getCompressOptions(this.db);
            const groupInfo = await this.db.getCgGroup(group);
            let currentCount = groupInfo ? (groupInfo.count || (groupInfo.imageUrls || []).length) : 0;
            let urls = groupInfo ? (groupInfo.imageUrls || []) : [];
            let added = 0;
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              if (!file.type.startsWith('image/')) continue;
              btn.textContent = `处理中 ${i + 1}/${files.length}...`;
              try {
                let blob = await compressImage(file, compOpts);
                currentCount++;
                await this.db.putCgImage(group, currentCount, blob, 'local://' + file.name);
                urls.push('local://' + file.name);
                added++;
              } catch (_) {}
            }
            if (added > 0) {
              await this.db.updateCgGroup(group, { count: currentCount, imageUrls: urls });
              this._renderCgGroupList();
            } else {
              btn.disabled = false;
              btn.textContent = origText;
            }
          };
          input.click();
        });
      });
      listEl.querySelectorAll('.bam-cg-preload').forEach(btn => {
        btn.addEventListener('click', async () => {
          const group = btn.dataset.group;
          btn.disabled = true;
          btn.textContent = '拉取中...';
          try {
            const result = await preloadCgGroup(this.db, group, (p) => {
              btn.textContent = `拉取中 ${p.current}/${p.total}...`;
            });
            alert(`${group}: 成功 ${result.loaded} 张, 跳过 ${result.skipped} 张${result.failed ? ', 失败 ' + result.failed + ' 张' : ''}`);
          } catch (err) { alert('拉取失败: ' + err.message); }
          this._renderCgGroupList();
        });
      });
      listEl.querySelectorAll('.bam-cg-clear').forEach(btn => {
        btn.addEventListener('click', async () => {
          const group = btn.dataset.group;
          if (!confirm(`确定清除 "${group}" 的图片缓存？`)) return;
          await this.db.clearCgGroupCache(group);
          this._renderCgGroupList();
        });
      });
      listEl.querySelectorAll('.bam-cg-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const group = btn.dataset.group;
          if (!confirm(`确定删除 CG 组 "${group}"？`)) return;
          await this.db.deleteCgGroup(group);
          this._renderCgGroupList();
        });
      });
      // 单条图片删除（仅本地上传的）
      listEl.querySelectorAll('.bam-cg-delete-single').forEach(btn => {
        btn.addEventListener('click', async () => {
          const group = btn.dataset.group;
          const index = parseInt(btn.dataset.index, 10);
          if (!confirm(`确定删除 ${group}#${index}？`)) return;
          // 从 cg_images 删除
          const id = 'cg__' + group + '__' + index;
          await new Promise((resolve, reject) => {
            const tx = this.db.db.transaction(STORE_CG_IMAGES, 'readwrite');
            tx.objectStore(STORE_CG_IMAGES).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new Error('删除失败'));
          });
          // 从 imageUrls 中移除对应条目并重建序号
          const groupInfo = await this.db.getCgGroup(group);
          if (groupInfo) {
            const urls = (groupInfo.imageUrls || []).slice();
            urls.splice(index - 1, 1);
            // 重建 cg_images 的序号映射（删除旧的，按新序号重写）
            const allImages = await new Promise((resolve, reject) => {
              const tx = this.db.db.transaction(STORE_CG_IMAGES, 'readonly');
              const idx = tx.objectStore(STORE_CG_IMAGES).index('group');
              const req = idx.getAll(IDBKeyRange.only(group));
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(new Error('查询失败'));
            });
            // 清除该组所有旧 cg_images
            await new Promise((resolve, reject) => {
              const tx = this.db.db.transaction(STORE_CG_IMAGES, 'readwrite');
              const store = tx.objectStore(STORE_CG_IMAGES);
              for (const img of allImages) store.delete(img.id);
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(new Error('清除失败'));
            });
            // 按新序号重写
            const sortedImages = allImages
              .filter(img => img.index !== index)
              .sort((a, b) => a.index - b.index);
            for (let i = 0; i < sortedImages.length; i++) {
              const newIdx = i + 1;
              const img = sortedImages[i];
              img.id = 'cg__' + group + '__' + newIdx;
              img.index = newIdx;
              await this.db._put(STORE_CG_IMAGES, img);
            }
            await this.db.updateCgGroup(group, { count: urls.length, imageUrls: urls });
          }
          this._renderCgGroupList();
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div style="color:#e55;font-size:12px;">加载失败: ' + err.message + '</div>';
    }
  }

  // -------------------- Live2D 素材管理 --------------------

  _formatLive2DBytes(size) {
    const value = Number(size) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
    return `${(value / 1024).toFixed(1)} KB`;
  }

  _setLive2DStatus(message) {
    const doc = this._getMainDocument();
    const statusEl = doc.getElementById('bam-live2d-status');
    if (statusEl) statusEl.textContent = message || '';
  }

  async _refreshLive2DList() {
    const doc = this._getMainDocument();
    const listEl = doc.getElementById('bam-live2d-list');
    if (!listEl) return;
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    this._setLive2DStatus(`正在读取 ${charLabel} 的 Live2D 文件列表...`);
    listEl.innerHTML = '<div style="text-align:center; color:#666; padding:30px 0; font-size:13px;">读取中...</div>';
    try {
      const charConfig = await this.db.getLive2DCharacterConfig(charId);
      const boundDirs = Object.keys(charConfig.models || {});
      const models = boundDirs.length ? await this.db.listLive2DModelsByDirs(boundDirs) : [];
      this._live2dModels = models;
      this._live2dActiveDir = charConfig.activeDir || '';
      const foundDirs = new Set(models.map(model => model.dir));
      const readErrors = Array.isArray(models.readErrors) ? models.readErrors : [];
      const readErrorDirs = new Set(Array.isArray(models.readErrorDirs) ? models.readErrorDirs : []);
      const missingDirs = boundDirs.filter(dir => !foundDirs.has(dir) && !readErrorDirs.has(dir));
      const warningHtml = [...missingDirs.map(dir => `${dir}: 绑定存在，但资源池中没有对应文件`), ...readErrors]
        .map(item => `<div style="color:#d99; font-size:11px; line-height:1.5; word-break:break-all;">${escapeHtmlAttr(item)}</div>`)
        .join('');
      if (!models.length) {
        listEl.innerHTML = `<div style="text-align:center; color:#555; padding:30px 0; font-size:13px;">${escapeHtmlAttr(charLabel)} 还没有可用的 Live2D 模型，点击上方按钮导入</div>${warningHtml ? `<div style="margin-top:8px; padding:10px; border:1px solid rgba(255,180,80,0.18); border-radius:8px; background:rgba(255,180,80,0.06);">${warningHtml}</div>` : ''}`;
        this._setLive2DStatus(`${charLabel} 未找到可用 Live2D 模型${missingDirs.length ? `，${missingDirs.length} 个绑定资源缺失` : ''}${readErrors.length ? `，${readErrors.length} 个目录读取失败` : ''}`);
        return;
      }
      listEl.innerHTML = `${warningHtml ? `<div style="margin-bottom:10px; padding:10px; border:1px solid rgba(255,180,80,0.18); border-radius:8px; background:rgba(255,180,80,0.06);">${warningHtml}</div>` : ''}${models.map(model => this._live2DModelHTML(model, model.dir === charConfig.activeDir)).join('')}`;
      const totalFiles = models.reduce((sum, model) => sum + model.files.length, 0);
      const totalSize = models.reduce((sum, model) => sum + model.totalSize, 0);
      this._setLive2DStatus(`${charLabel}: ${models.length} 个模型，${totalFiles} 个文件，${this._formatLive2DBytes(totalSize)}${missingDirs.length > 0 ? `，${missingDirs.length} 个绑定资源缺失` : ''}${readErrors.length > 0 ? `，${readErrors.length} 个目录读取失败` : ''}`);
    } catch (err) {
      listEl.innerHTML = `<div style="color:#e55; font-size:12px; padding:12px;">Live2D 列表读取失败: ${escapeHtmlAttr(err.message)}</div>`;
      this._setLive2DStatus('Live2D 列表读取失败');
    }
  }

  _live2DModelHTML(model, isActive = false) {
    const safeDir = escapeHtmlAttr(model.dir);
    const safeVersion = escapeHtmlAttr(model.version || '未写入版本');
    const normalCount = model.states?.normal?.count || 0;
    const destroyCount = model.states?.destroy?.count || 0;
    return `<div class="bam-live2d-card" data-dir="${safeDir}" style="background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
      <div style="display:flex; align-items:flex-start; gap:10px;">
        <button data-live2d-action="toggle" data-dir="${safeDir}" style="background:none; border:none; color:#888; cursor:pointer; font-size:13px; padding:2px 0;">▶</button>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <span style="color:#ddd; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeDir}">${safeDir}</span>
            ${isActive ? '<span style="color:#7ee787; font-size:10px; border:1px solid rgba(126,231,135,0.3); border-radius:999px; padding:1px 6px;">当前</span>' : ''}
            ${model.hasDestroy ? '<span style="color:#f59e0b; font-size:10px; border:1px solid rgba(245,158,11,0.3); border-radius:999px; padding:1px 6px;">destroy</span>' : ''}
          </div>
          <div style="color:#666; font-size:11px; margin-top:4px;">${normalCount} normal / ${destroyCount} destroy · ${model.files.length} 文件 · ${this._formatLive2DBytes(model.totalSize)} · ${safeVersion}</div>
        </div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; padding-left:24px;">
        <button data-live2d-action="activate" data-dir="${safeDir}" style="background:rgba(74,108,247,0.14); border:1px solid rgba(74,108,247,0.28); color:#b9c7ff; padding:4px 9px; border-radius:6px; cursor:pointer; font-size:11px;">设为当前</button>
        <button data-live2d-action="export" data-dir="${safeDir}" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#bbb; padding:4px 9px; border-radius:6px; cursor:pointer; font-size:11px;">导出 ZIP</button>
        <button data-live2d-action="delete" data-dir="${safeDir}" style="background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.2); color:#e88; padding:4px 9px; border-radius:6px; cursor:pointer; font-size:11px;">移出本角色卡</button>
      </div>
      <div class="bam-live2d-files" data-dir="${safeDir}" style="display:none; margin:10px 0 0 24px; max-height:220px; overflow-y:auto; background:rgba(0,0,0,0.18); border-radius:8px; padding:6px 8px;"></div>
    </div>`;
  }

  _renderLive2DFileRows(model) {
    return (model?.files || []).map(file => `
      <div style="display:grid; grid-template-columns:64px 1fr 76px; gap:8px; align-items:center; padding:4px 0; border-top:1px solid rgba(255,255,255,0.04);">
        <span style="color:${file.state === 'destroy' ? '#f59e0b' : '#7ee787'}; font-size:10px;">${escapeHtmlAttr(file.state)}</span>
        <span title="${escapeHtmlAttr(file.key)}" style="color:#aaa; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtmlAttr(file.relativePath)}</span>
        <span style="color:#666; font-size:10px; text-align:right;">${this._formatLive2DBytes(file.size)}</span>
      </div>`).join('');
  }

  _toggleLive2DFileList(dir) {
    const doc = this._getMainDocument();
    const card = doc.querySelector(`.bam-live2d-card[data-dir="${CSS.escape(dir)}"]`);
    const filesEl = card?.querySelector('.bam-live2d-files');
    const toggleBtn = card?.querySelector('[data-live2d-action="toggle"]');
    if (!filesEl) return;
    const nextVisible = filesEl.style.display === 'none';
    if (nextVisible && !filesEl.dataset.rendered) {
      const model = (this._live2dModels || []).find(item => item.dir === dir);
      filesEl.innerHTML = this._renderLive2DFileRows(model);
      filesEl.dataset.rendered = '1';
    }
    filesEl.style.display = nextVisible ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = nextVisible ? '▼' : '▶';
  }

  async _handleLive2DImport(importer, label) {
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    this._setLive2DStatus(`${label}中...`);
    try {
      const result = await importer();
      const importedCount = Number(result.imported || 0);
      const skippedCount = Number(result.skipped || 0);
      const errors = Array.isArray(result.errors) ? result.errors : [];
      const failedCount = errors.length;
      const totalCount = importedCount + failedCount + skippedCount;
      const summary = `共 ${totalCount} 个模型，成功 ${importedCount} 个，失败 ${failedCount} 个${skippedCount ? `，跳过 ${skippedCount} 个` : ''}`;
      let message = `Live2D ${label}完成\n${summary}\n已绑定到: ${charLabel}`;
      if (result.adjutant?.live2d?.dir) {
        try { localStorage.setItem('gfl-adjutant', JSON.stringify(result.adjutant)); } catch (_) {}
        message += `\n当前启用: ${result.adjutant.live2d.dir}`;
      }
      if (failedCount) {
        message += `\n\n失败原因:\n${errors.map(item => `- ${item}`).join('\n')}`;
      }
      this._setLive2DStatus(`Live2D ${label}完成：${summary}`);
      alert(message);
      await this._refreshLive2DList();
      this._setLive2DStatus(`Live2D ${label}完成：${summary}`);
    } catch (err) {
      alert(`Live2D ${label}失败: ${err.message}`);
      this._setLive2DStatus(`${label}失败`);
    }
  }

  async _handleLive2DExport(dir) {
    this._setLive2DStatus(`正在导出 ${dir}...`);
    try {
      const exported = await this.db.exportLive2DModelToFile(dir, (msg) => this._setLive2DStatus(msg));
      this._setLive2DStatus(`已导出 ${exported.dir}: ${exported.assetCount} 个文件`);
    } catch (err) {
      alert('Live2D 导出失败: ' + err.message);
      this._setLive2DStatus('Live2D 导出失败');
    }
  }

  async _handleLive2DDelete(dir) {
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    if (!confirm(`确定从 ${charLabel} 移出 Live2D 模型 "${dir}"？\n这不会删除资源池中的模型文件，其他角色卡不受影响。`)) return;
    this._setLive2DStatus(`正在从 ${charLabel} 移出 ${dir}...`);
    try {
      await this.db.unbindLive2DModelFromCharacter(charId, dir);
      this._setLive2DStatus(`已从 ${charLabel} 移出 ${dir}`);
      await this._refreshLive2DList();
    } catch (err) {
      alert('Live2D 移出失败: ' + err.message);
      this._setLive2DStatus('Live2D 移出失败');
    }
  }

  async _handleLive2DClearBindings() {
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    if (!confirm(`确定清空 ${charLabel} 的全部 Live2D 绑定？\n这不会删除资源池中的模型文件，只用于重新测试导入绑定。`)) return;
    this._setLive2DStatus(`正在清空 ${charLabel} 的 Live2D 绑定...`);
    try {
      const count = await this.db.clearLive2DCharacterBindings(charId);
      try { localStorage.removeItem('gfl-adjutant'); } catch (_) {}
      this._setLive2DStatus(`已清空 ${charLabel} 的 ${count} 个 Live2D 绑定`);
      await this._refreshLive2DList();
      alert(`已清空 ${charLabel} 的 ${count} 个 Live2D 绑定。\n资源池文件未删除，可以直接重新导入或重新绑定。`);
    } catch (err) {
      alert('Live2D 清空失败: ' + err.message);
      this._setLive2DStatus('Live2D 清空失败');
    }
  }

  async _handleLive2DActivate(dir) {
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    const models = this._live2dModels || await this.db.listLive2DModels();
    const model = models.find(item => item.dir === dir);
    if (!model) { alert(`未找到 ${charLabel} 绑定的 Live2D 模型: ${dir}`); return; }
    const adjutant = {
      name: dir,
      live2d: {
        dir,
        jsonPath: `indexeddb://${dir}/normal/model.json`,
        version: model.version || String(Date.now()),
        hasDestroy: !!model.hasDestroy
      }
    };
    try {
      await this.db.setLive2DActiveForCharacter(charId, dir);
      localStorage.setItem('gfl-adjutant', JSON.stringify(adjutant));
      this._setLive2DStatus(`已将 ${dir} 设为 ${charLabel} 当前 Live2D`);
      await this._refreshLive2DList();
      alert(`已将 ${dir} 设为 ${charLabel} 当前 Live2D`);
    } catch (err) {
      alert('Live2D 启用失败: ' + err.message);
    }
  }

  async _handleLive2DExportAll() {
    const charId = this._getActiveCharId();
    const charLabel = charId === GLOBAL_CHAR_ID ? '全局分区' : (this._charName || '当前角色卡');
    const exportBtn = $('#bam-btn-live2d-export-zip');
    const origExportText = exportBtn ? exportBtn.textContent : '';
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '导出中...'; }
    try {
      const manifests = await this.db.exportAllLive2DModelsToFile(charId, (msg) => {
        if (exportBtn) exportBtn.textContent = msg;
      });
      const totalFiles = manifests.reduce((sum, m) => sum + m.assetCount, 0);
      const totalSize = manifests.reduce((sum, m) => sum + m.totalSize, 0);
      this._setLive2DStatus(`已导出 ${charLabel} 的 ${manifests.length} 个模型，${totalFiles} 个文件，${this._formatLive2DBytes(totalSize)}`);
      alert(`Live2D 导出完成\n${charLabel}: ${manifests.length} 个模型，${totalFiles} 个文件\n已下载 ZIP 文件`);
      await this._refreshLive2DList();
    } catch (err) {
      alert('Live2D 导出失败: ' + err.message);
      this._setLive2DStatus('Live2D 导出失败');
    } finally {
      if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = origExportText; }
    }
  }

  // -------------------- 情绪差分面板 --------------------

  async _handleMoodToggle(name) {
    const doc = this._getMainDocument();
    const panel = doc.querySelector(`.bam-mood-panel[data-name="${name}"]`);
    if (!panel) return;

    if (this._expandedMoodName === name) {
      panel.style.display = 'none';
      this._expandedMoodName = null;
      return;
    }

    doc.querySelectorAll('.bam-mood-panel').forEach(p => { p.style.display = 'none'; });
    this._expandedMoodName = name;
    await this._renderMoodPanel(name);
  }

  async _renderMoodPanel(name) {
    const doc = this._getMainDocument();
    const panel = doc.querySelector(`.bam-mood-panel[data-name="${name}"]`);
    if (!panel) return;

    const charId = this._getActiveCharId();
    const safeName = escapeHtmlAttr(name);
    const moodAvatars = await this.db.listMoodAvatars(charId, name);
    const moodMap = new Map(moodAvatars.map(ma => [ma.moodId, ma]));
    const uploadedCount = moodMap.size;

    // 从 mood_config 动态读取颜色，回退到 MOOD_GROUPS 默认色
    const moodColorMap = new Map(MOOD_GROUPS.map(g => [g.id, g.color]));
    try {
      const raw = await this.db.getConfig('mood_config', null);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.groups)) {
          parsed.groups.forEach(g => { if (g.id && g.color) moodColorMap.set(g.id, g.color); });
        }
      }
    } catch (_) { /* 回退到默认色 */ }

    let html = `<div style="color:#999; font-size:11px; margin-bottom:8px;">情绪差分头像（已上传 ${uploadedCount}/8）</div>`;
    for (const group of MOOD_GROUPS) {
      const groupColor = moodColorMap.get(group.id) || group.color;
      const colorDot = `<span style="width:16px; height:16px; border-radius:50%; background:${groupColor}; display:inline-block; flex-shrink:0;"></span>`;
      const ma = moodMap.get(group.id);
      if (ma) {
        const blobUrl = await this.db.getMoodAvatarBlobUrl(charId, name, group.id);
        const safeMoodSrc = blobUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const moodSourceTag = (ma.sourceUrl && ma.sourceUrl !== 'null')
          ? (ma.imageBlob ? '<span style="color:#58a6ff;font-size:9px;">远程✓</span>' : '<span style="color:#eab308;font-size:9px;">远程⏳</span>')
          : '<span style="color:#7ee787;font-size:9px;">本地</span>';
        html += `<div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          ${colorDot}
          <span style="width:40px; color:#aaa; font-size:12px;">${group.label}</span>
          <img src="${safeMoodSrc}" class="bam-avatar-thumb" data-preview-src="${safeMoodSrc}" data-preview-title="${safeName} · ${group.label}" style="width:32px; height:32px; border-radius:4px; object-fit:cover; border:1px solid rgba(255,255,255,0.1); cursor:pointer;" />
          ${moodSourceTag}
          <span style="flex:1; color:#666; font-size:11px;">${(ma.fileSize/1024).toFixed(1)} KB</span>
          <button class="bam-mood-action bam-mood-upload" data-name="${safeName}" data-mood-id="${group.id}" style="background:rgba(255,255,255,0.06); border:none; color:#888; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px;">替换</button>
          <button class="bam-mood-action bam-mood-delete" data-name="${safeName}" data-mood-id="${group.id}" style="background:rgba(255,80,80,0.1); border:none; color:#e55; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px;">删除</button>
        </div>`;
      } else {
        html += `<div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          ${colorDot}
          <span style="width:40px; color:#aaa; font-size:12px;">${group.label}</span>
          <button class="bam-mood-action bam-mood-upload" data-name="${safeName}" data-mood-id="${group.id}" style="flex:1; background:rgba(255,255,255,0.04); border:1px dashed rgba(255,255,255,0.1); color:#666; padding:4px 0; border-radius:4px; cursor:pointer; font-size:11px; text-align:center;">点击上传</button>
          <button class="bam-mood-action bam-mood-remote" data-name="${safeName}" data-mood-id="${group.id}" style="background:none; border:1px dashed rgba(74,108,247,0.3); color:#8ba4f7; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; flex-shrink:0;">🔗</button>
        </div>`;
      }
    }
    panel.innerHTML = html;
    panel.style.display = 'block';
  }

  async _handleMoodUpload(name, moodId) {
    const doc = this._getMainDocument();
    const charId = this._getActiveCharId();
    const moodBtn = doc.querySelector(`.bam-mood-upload[data-name="${name}"][data-mood-id="${moodId}"]`);
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { alert('图片不能超过 2MB'); return; }
      const origText = moodBtn ? moodBtn.textContent : '';
      if (moodBtn) { moodBtn.disabled = true; moodBtn.textContent = '处理中...'; }
      try {
        const meta = await this._getImageMeta(file);
        const compOpts = await getCompressOptions(this.db);
        const blob = await compressImage(file, compOpts);
        await this.db.addMoodAvatar(charId, name, moodId, blob, meta);
        await this._renderMoodPanel(name);
        this._requestAvatarAssetPreviewRefresh();
      } catch (err) {
        alert('上传失败: ' + err.message);
        if (moodBtn) { moodBtn.disabled = false; moodBtn.textContent = origText; }
      }
    };
    input.click();
  }

  async _handleMoodRemoteUrl(name, moodId) {
    const url = prompt(`输入 "${name}" 的 ${moodId} 情绪差分远程图片 URL:`);
    if (!url || !url.trim()) return;
    const charId = this._getActiveCharId();
    try {
      const id = buildMoodAvatarKey(charId, name, moodId);
      const existing = await this.db._getByKey(STORE_MOOD_AVATARS, id);
      if (existing) {
        existing.sourceUrl = url.trim();
        existing.updatedAt = Date.now();
        await this.db._put(STORE_MOOD_AVATARS, existing);
      } else {
        const record = {
          id, charId, alias: name.trim().toLowerCase(), moodId,
          imageBlob: null, sourceUrl: url.trim(),
          mimeType: 'image/webp', fileName: '',
          fileSize: 0, width: 0, height: 0,
          createdAt: Date.now(), updatedAt: Date.now()
        };
        await this.db._put(STORE_MOOD_AVATARS, record);
      }
      await this._renderMoodPanel(name);
    } catch (err) { alert('设置失败: ' + err.message); }
  }

  async _handleMoodDelete(name, moodId) {
    const group = MOOD_GROUPS.find(g => g.id === moodId);
    if (!confirm(`确定删除 "${name}" 的 ${group?.label || moodId} 差分头像吗？`)) return;
    try {
      await this.db.deleteMoodAvatar(this._getActiveCharId(), name, moodId);
      await this._renderMoodPanel(name);
      this._requestAvatarAssetPreviewRefresh();
    } catch (err) { alert('删除失败: ' + err.message); }
  }

  // -------------------- Tab 切换 --------------------

  _switchTab(tabName) {
    const doc = this._getMainDocument();
    this.currentTab = tabName;
    doc.querySelectorAll('.bam-tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.style.color = isActive ? '#e0e0e0' : '#666';
      btn.style.fontWeight = isActive ? '600' : '500';
      btn.style.borderBottomColor = isActive ? '#4a6cf7' : 'transparent';
    });
    const avatarTab = doc.getElementById('bam-tab-avatar');
    const styleTab = doc.getElementById('bam-tab-style');
    const moodTab = doc.getElementById('bam-tab-mood');
    const live2dTab = doc.getElementById('bam-tab-live2d');
    const importBtn = doc.getElementById('bam-btn-import');
    const exportBtn = doc.getElementById('bam-btn-export');

    avatarTab.style.display = 'none';
    styleTab.style.display = 'none';
    moodTab.style.display = 'none';
    if (live2dTab) live2dTab.style.display = 'none';
    importBtn.style.display = 'none';
    exportBtn.style.display = 'none';

    if (tabName === 'avatar') {
      avatarTab.style.display = 'flex';
      importBtn.style.display = '';
      exportBtn.style.display = '';
      // 切换回头像管理时刷新已展开的差分面板（颜色可能在情绪配置页被修改）
      if (this._expandedMoodName) {
        this._renderMoodPanel(this._expandedMoodName);
      }
    } else if (tabName === 'style') {
      styleTab.style.display = 'flex';
      if (!this._styleDraftLoaded) this._loadStyleSettings();
      this._renderLocalFontList();
      this._renderCssFontSources();
    } else if (tabName === 'mood') {
      moodTab.style.display = 'flex';
      if (!this._moodConfigLoaded) this._loadMoodConfigTab();
    } else if (tabName === 'live2d') {
      if (live2dTab) live2dTab.style.display = 'flex';
      this._refreshLive2DList();
    }
  }

  // -------------------- 正文美化：加载配置 --------------------

  _applyStyleSettingsToControls(settings) {
    const doc = this._getMainDocument();
    const $ = (s) => doc.querySelector(s);

    $('#bam-range-dialogue-font').value = settings.style_dialogueFontSize;
    $('#bam-val-dialogue-font').textContent = `${settings.style_dialogueFontSize}px`;
    $('#bam-range-narration-font').value = settings.style_narrationFontSize;
    $('#bam-val-narration-font').textContent = `${settings.style_narrationFontSize}px`;
    $('#bam-range-dialogue-spacing').value = settings.style_dialogueSpacing;
    $('#bam-val-dialogue-spacing').textContent = `${settings.style_dialogueSpacing}px`;
    $('#bam-range-dialogue-weight').value = settings.style_dialogueFontWeight;
    $('#bam-val-dialogue-weight').textContent = `${settings.style_dialogueFontWeight}`;
    $('#bam-range-narration-weight').value = settings.style_narrationFontWeight;
    $('#bam-val-narration-weight').textContent = `${settings.style_narrationFontWeight}`;
    $('#bam-range-name-weight').value = settings.style_nameFontWeight;
    $('#bam-val-name-weight').textContent = `${settings.style_nameFontWeight}`;
    $('#bam-global-color-picker').value = settings.style_globalTextColor;
    $('#bam-narration-bg-color').value = settings.style_narrationBgColor;
    $('#bam-range-narration-bg-opacity').value = settings.style_narrationBgOpacity;
    $('#bam-val-narration-bg-opacity').textContent = Number.parseFloat(settings.style_narrationBgOpacity).toFixed(2);
    $('#bam-range-avatar-size').value = settings.style_avatarSize;
    $('#bam-val-avatar-size').textContent = `${settings.style_avatarSize}px`;
    $('#bam-range-narration-indent').value = settings.style_narrationIndent;
    $('#bam-val-narration-indent').textContent = `${settings.style_narrationIndent}px`;
    $('#bam-range-narration-border-radius').value = settings.style_narrationBorderRadius;
    $('#bam-val-narration-border-radius').textContent = `${settings.style_narrationBorderRadius}px`;
    $('#bam-range-thought-suffix-gap').value = settings.style_thoughtSuffixGap;
    $('#bam-val-thought-suffix-gap').textContent = `${settings.style_thoughtSuffixGap}px`;
    $('#bam-range-thought-suffix-offset-y').value = settings.style_thoughtSuffixOffsetY;
    $('#bam-val-thought-suffix-offset-y').textContent = `${settings.style_thoughtSuffixOffsetY}px`;
    // v7.0
    if ($('#bam-range-narration-text-indent')) {
      $('#bam-range-narration-text-indent').value = settings.style_narrationTextIndent;
      $('#bam-val-narration-text-indent').textContent = `${settings.style_narrationTextIndent}em`;
    }
    if ($('#bam-range-narration-line-height')) {
      $('#bam-range-narration-line-height').value = settings.style_narrationLineHeight;
      $('#bam-val-narration-line-height').textContent = `${settings.style_narrationLineHeight}`;
    }
    if ($('#bam-range-narration-padding-right')) {
      $('#bam-range-narration-padding-right').value = settings.style_narrationPaddingRight;
      $('#bam-val-narration-padding-right').textContent = `${settings.style_narrationPaddingRight}px`;
    }
    if ($('#bam-chk-compress-enabled')) {
      $('#bam-chk-compress-enabled').checked = settings.style_imageCompressEnabled !== false && settings.style_imageCompressEnabled !== 'false';
    }
    if ($('#bam-range-compress-quality')) {
      $('#bam-range-compress-quality').value = settings.style_imageCompressQuality;
      $('#bam-val-compress-quality').textContent = `${Number(settings.style_imageCompressQuality).toFixed(2)}`;
    }
    $('#bam-font-url-input').value = settings.style_fontConfigUrl || '';

    doc.querySelectorAll('input[name="bam-color-mode"]').forEach((radio) => {
      radio.checked = radio.value === settings.style_textColorMode;
    });
    doc.querySelectorAll('input[name="bam-md-mode"]').forEach((radio) => {
      radio.checked = radio.value === settings.style_markdownMode;
    });
    doc.querySelectorAll('input[name="bam-avatar-shape"]').forEach((radio) => {
      radio.checked = radio.value === settings.style_avatarShape;
    });

    $('#bam-select-narration-font').value = settings.style_narrationFontFamily;
    $('#bam-select-dialogue-font').value = settings.style_dialogueFontFamily;
    $('#bam-select-name-font').value = settings.style_nameFontFamily;
  }

  _setStyleDraftDirty(isDirty) {
    this._styleDraftDirty = Boolean(isDirty);
    const doc = this._getMainDocument();
    const saveBtn = doc.getElementById('bam-btn-save-style');
    const tipEl = doc.getElementById('bam-style-save-tip');
    if (saveBtn) {
      saveBtn.disabled = !this._styleDraftDirty;
      saveBtn.style.opacity = this._styleDraftDirty ? '1' : '0.65';
      saveBtn.style.cursor = this._styleDraftDirty ? 'pointer' : 'default';
    }
    if (tipEl) {
      tipEl.textContent = this._styleDraftDirty
        ? '当前调整仅作用于预览，点击保存后下次静态重渲染会读取新值'
        : '当前样式已保存；调整时只影响预览，点击保存后下次静态重渲染读取新值';
    }
  }

  async _loadStyleSettings() {
    const settings = this._getDefaultStyleSettings();
    for (const key of Object.keys(settings)) {
      settings[key] = await this.db.getConfig(key, settings[key]);
    }

    this._applyStyleSettingsToControls(settings);
    await this._refreshFontSelectors({ silent: true });
    this._applyStyleSettingsToControls(settings);
    this._styleDraftLoaded = true;
    this._setStyleDraftDirty(false);
    await this._applyBubblePreviewStyles(settings);
  }

  // -------------------- 正文美化：保存当前草稿 --------------------

  async _saveCurrentStyleSettings() {
    const settings = this._getLiveStyleSettings();
    try {
      writeStyleSnapshot(settings, { replace: true });
      await Promise.all(Object.entries(settings).map(([key, value]) => this.db.setConfig(key, value)));
      this._styleDraftLoaded = true;
      this._setStyleDraftDirty(false);
    }
    catch (err) {
      console.error('保存样式配置失败:', err);
      alert('保存样式失败: ' + err.message);
    }
  }

  // -------------------- 正文美化：恢复默认草稿 --------------------

  async _resetStyleDefaults() {
    const defaults = this._getDefaultStyleSettings();
    this._applyStyleSettingsToControls(defaults);
    await this._refreshFontSelectors({ silent: true });
    this._applyStyleSettingsToControls(defaults);
    this._styleDraftLoaded = true;
    this._setStyleDraftDirty(true);
    await this._applyBubblePreviewStyles(defaults);
  }

  // -------------------- 情绪配置 Tab --------------------

  async _loadMoodConfigTab() {
    // 从 IndexedDB 读取已保存的配置，回退到默认值
    const formatRule = await this.db.getConfig('format_rule', null);
    this._formatRuleDraft = (formatRule && typeof formatRule === 'string' && formatRule.trim())
      ? formatRule
      : DEFAULT_FORMAT_RULE;

    // 读取情绪词提示词模板
    const moodPromptTemplate = await this.db.getConfig('mood_prompt_template', null);
    this._moodPromptTemplateDraft = (moodPromptTemplate && typeof moodPromptTemplate === 'string' && moodPromptTemplate.trim())
      ? moodPromptTemplate
      : DEFAULT_MOOD_PROMPT_TEMPLATE;

    // 读取注入角色配置（system / user）
    const injectionRole = await this.db.getConfig('injection_role', null);
    this._injectionRoleDraft = (injectionRole === 'user') ? 'user' : 'system';

    const moodConfigRaw = await this.db.getConfig('mood_config', null);
    if (moodConfigRaw) {
      try {
        const parsed = JSON.parse(moodConfigRaw);
        this._moodConfigDraft = Array.isArray(parsed.groups)
          ? parsed.groups.map(g => ({ ...g, words: [...g.words] }))
          : DEFAULT_MOOD_GROUPS.map(g => ({ ...g, words: [...g.words] }));
      } catch (_) {
        this._moodConfigDraft = DEFAULT_MOOD_GROUPS.map(g => ({ ...g, words: [...g.words] }));
      }
    } else {
      this._moodConfigDraft = DEFAULT_MOOD_GROUPS.map(g => ({ ...g, words: [...g.words] }));
    }

    this._moodConfigLoaded = true;
    this._moodConfigDirty = false;
    this._renderMoodConfigContent();
    this._bindMoodConfigEvents();
  }

  _renderMoodConfigContent() {
    const doc = this._getMainDocument();
    const container = doc.getElementById('bam-tab-mood');
    if (!container) return;

    let html = '';

    // 格式规则区域
    html += `
      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">格式规则</div>
      <div style="color:#b08a3a; font-size:11px; margin-bottom:8px; padding:6px 10px; background:rgba(176,138,58,0.1); border-radius:6px;">⚠ 修改格式规则可能导致 AI 输出格式异常，请谨慎编辑。如遇问题，点击「恢复默认格式」还原。</div>
      <textarea id="bam-format-rule-textarea" style="
        width:100%; min-height:200px; max-height:300px; resize:vertical;
        background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1);
        border-radius:8px; padding:10px; color:#d0d0d0; font-size:12px;
        font-family:'Fira Code','Source Code Pro',monospace; line-height:1.5;
        outline:none; box-sizing:border-box;
      ">${escapeHtmlAttr(this._formatRuleDraft)}</textarea>
      <div style="display:flex; justify-content:flex-end; margin:8px 0 16px;">
        <button id="bam-btn-reset-format-rule" style="background:rgba(255,255,255,0.06); border:none; color:#aaa; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">恢复默认格式</button>
      </div>
    `;

    // 情绪词配置区域
    html += `<div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">情绪词配置</div>`;

    for (let gi = 0; gi < this._moodConfigDraft.length; gi++) {
      const group = this._moodConfigDraft[gi];
      html += `
      <div class="bam-mood-group" data-group-index="${gi}" style="margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span style="width:16px; height:16px; border-radius:50%; background:${group.color}; display:inline-block; flex-shrink:0;"></span>
          <span style="color:#ccc; font-size:13px; font-weight:600;">${group.label}</span>
          <input type="color" class="bam-mood-color-picker" data-group-index="${gi}" value="${group.color}"
            style="width:24px; height:24px; border:none; background:none; cursor:pointer; padding:0; margin-left:auto;" title="修改分类颜色" />
        </div>
        <div class="bam-mood-words-container" data-group-index="${gi}" style="display:flex; flex-wrap:wrap; gap:6px; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:8px;">`;

      for (let wi = 0; wi < group.words.length; wi++) {
        const word = group.words[wi];
        html += `<span class="bam-mood-word-tag" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; background:rgba(255,255,255,0.06); border-radius:4px; font-size:12px; color:#ccc;">
          ${escapeHtmlAttr(word)}<button class="bam-mood-word-delete" data-group-index="${gi}" data-word-index="${wi}" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px; padding:0 2px; line-height:1;">&times;</button>
        </span>`;
      }

      html += `
          <button class="bam-mood-word-add" data-group-index="${gi}" style="display:inline-flex; align-items:center; padding:3px 8px; background:rgba(74,108,247,0.12); border:1px dashed rgba(74,108,247,0.3); border-radius:4px; color:#8ba4f7; font-size:12px; cursor:pointer;">+ 添加</button>
        </div>
      </div>`;
    }

    // 情绪词提示词模板区域
    html += `
      <div style="color:#666; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:16px 0 10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">情绪词提示词模板</div>
      <div style="color:#6b8acd; font-size:11px; margin-bottom:8px; padding:6px 10px; background:rgba(107,138,205,0.1); border-radius:6px;">
        ℹ 此模板控制注入给 AI 的情绪词约束提示词。使用 <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;">{{mood_groups}}</code> 占位符表示情绪词分组列表（保存时自动替换为实际词库）。
      </div>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:6px;">
        <span style="color:#999; font-size:12px; flex-shrink:0;">注入角色：</span>
        <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:#ccc;">
          <input type="radio" name="bam-injection-role" value="system" ${this._injectionRoleDraft === 'system' ? 'checked' : ''} style="margin:0; accent-color:#4a6cf7;" />
          System
        </label>
        <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:#ccc;">
          <input type="radio" name="bam-injection-role" value="user" ${this._injectionRoleDraft === 'user' ? 'checked' : ''} style="margin:0; accent-color:#4a6cf7;" />
          User
        </label>
        <span style="color:#666; font-size:11px; margin-left:auto;">部分模型对 User 角色指令更敏感</span>
      </div>
      <textarea id="bam-mood-prompt-template-textarea" style="
        width:100%; min-height:120px; max-height:200px; resize:vertical;
        background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1);
        border-radius:8px; padding:10px; color:#d0d0d0; font-size:12px;
        font-family:'Fira Code','Source Code Pro',monospace; line-height:1.5;
        outline:none; box-sizing:border-box;
      ">${escapeHtmlAttr(this._moodPromptTemplateDraft)}</textarea>
      <div style="display:flex; justify-content:flex-end; margin:8px 0 16px;">
        <button id="bam-btn-reset-mood-prompt-template" style="background:rgba(255,255,255,0.06); border:none; color:#aaa; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">恢复默认模板</button>
      </div>
    `;

    // 底部按钮
    html += `
      <div style="display:flex; justify-content:center; gap:12px; margin:16px 0 8px;">
        <button id="bam-btn-save-mood" style="background:#4a6cf7; border:none; color:#fff; padding:8px 24px; border-radius:6px; cursor:pointer; font-size:13px;">保存</button>
        <button id="bam-btn-reset-mood" style="background:rgba(255,255,255,0.06); border:none; color:#aaa; padding:8px 24px; border-radius:6px; cursor:pointer; font-size:13px;">恢复默认</button>
      </div>
      <div id="bam-mood-save-tip" style="text-align:center; color:#555; font-size:11px; padding:8px 0;">
        修改后点击保存生效；保存后格式规则和情绪词将同步更新到 AI 注入</div>
    `;

    container.innerHTML = html;
  }

  _bindMoodConfigEvents() {
    const doc = this._getMainDocument();
    const moodTab = doc.getElementById('bam-tab-mood');
    if (!moodTab) return;

    // 格式规则文本变化
    const textarea = doc.getElementById('bam-format-rule-textarea');
    textarea?.addEventListener('input', () => {
      this._formatRuleDraft = textarea.value;
      this._moodConfigDirty = true;
    });

    // 情绪词提示词模板文本变化
    const moodPromptTextarea = doc.getElementById('bam-mood-prompt-template-textarea');
    moodPromptTextarea?.addEventListener('input', () => {
      this._moodPromptTemplateDraft = moodPromptTextarea.value;
      this._moodConfigDirty = true;
    });

    // 注入角色切换
    const roleRadios = moodTab.querySelectorAll('input[name="bam-injection-role"]');
    roleRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        this._injectionRoleDraft = radio.value;
        this._moodConfigDirty = true;
      });
    });

    // 情绪词删除
    moodTab.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.bam-mood-word-delete');
      if (!delBtn) return;
      const gi = parseInt(delBtn.dataset.groupIndex, 10);
      const wi = parseInt(delBtn.dataset.wordIndex, 10);
      const group = this._moodConfigDraft[gi];
      if (!group) return;
      if (group.words.length <= 1) { alert('每个分类至少保留 1 个情绪词'); return; }
      group.words.splice(wi, 1);
      this._moodConfigDirty = true;
      this._renderMoodConfigContent();
      this._rebindMoodConfigDynamicEvents();
    });

    // 情绪词添加
    moodTab.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.bam-mood-word-add');
      if (!addBtn) return;
      const gi = parseInt(addBtn.dataset.groupIndex, 10);
      const group = this._moodConfigDraft[gi];
      if (!group) return;
      const word = prompt('请输入 2~3 个汉字的情绪词：');
      if (!word) return;
      const trimmed = word.trim();
      if (!/^[\u4e00-\u9fff]{2,3}$/.test(trimmed)) { alert('情绪词必须为 2~3 个汉字'); return; }
      // 跨分类去重
      for (const g of this._moodConfigDraft) {
        if (g.words.includes(trimmed)) {
          alert(`「${trimmed}」已存在于「${g.label}」分类中，不可重复`);
          return;
        }
      }
      group.words.push(trimmed);
      this._moodConfigDirty = true;
      this._renderMoodConfigContent();
      this._rebindMoodConfigDynamicEvents();
    });

    // 颜色调色盘
    moodTab.addEventListener('input', (e) => {
      const colorPicker = e.target.closest('.bam-mood-color-picker');
      if (!colorPicker) return;
      const gi = parseInt(colorPicker.dataset.groupIndex, 10);
      if (this._moodConfigDraft[gi]) {
        this._moodConfigDraft[gi].color = colorPicker.value;
        this._moodConfigDirty = true;
        // 同步更新色块
        const groupEl = colorPicker.closest('.bam-mood-group');
        if (groupEl) {
          const dot = groupEl.querySelector('span[style*="border-radius:50%"]');
          if (dot) dot.style.background = colorPicker.value;
        }
      }
    });

    // 保存按钮（事件委托，避免 innerHTML 重建后丢失）
    moodTab.addEventListener('click', async (e) => {
      if (e.target.closest('#bam-btn-save-mood')) {
        await this._saveMoodConfig();
      }
    });

    // 恢复默认按钮（事件委托）
    moodTab.addEventListener('click', (e) => {
      if (e.target.closest('#bam-btn-reset-mood')) {
        if (!confirm('确定恢复为默认的格式规则、情绪词配置和提示词模板？')) return;
        this._formatRuleDraft = DEFAULT_FORMAT_RULE;
        this._moodPromptTemplateDraft = DEFAULT_MOOD_PROMPT_TEMPLATE;
        this._injectionRoleDraft = 'system';
        this._moodConfigDraft = DEFAULT_MOOD_GROUPS.map(g => ({ ...g, words: [...g.words] }));
        this._moodConfigDirty = true;
        this._renderMoodConfigContent();
        this._rebindMoodConfigDynamicEvents();
      }
    });

    // 恢复默认格式按钮（事件委托）
    moodTab.addEventListener('click', (e) => {
      if (e.target.closest('#bam-btn-reset-format-rule')) {
        this._formatRuleDraft = DEFAULT_FORMAT_RULE;
        const ta = doc.getElementById('bam-format-rule-textarea');
        if (ta) ta.value = DEFAULT_FORMAT_RULE;
        this._moodConfigDirty = true;
      }
    });

    // 恢复默认情绪词提示词模板按钮（事件委托）
    moodTab.addEventListener('click', (e) => {
      if (e.target.closest('#bam-btn-reset-mood-prompt-template')) {
        this._moodPromptTemplateDraft = DEFAULT_MOOD_PROMPT_TEMPLATE;
        const ta = doc.getElementById('bam-mood-prompt-template-textarea');
        if (ta) ta.value = DEFAULT_MOOD_PROMPT_TEMPLATE;
        this._moodConfigDirty = true;
      }
    });
  }

  _rebindMoodConfigDynamicEvents() {
    // 重新渲染后需要重新绑定 textarea 的 input 事件
    const doc = this._getMainDocument();
    const textarea = doc.getElementById('bam-format-rule-textarea');
    textarea?.addEventListener('input', () => {
      this._formatRuleDraft = textarea.value;
      this._moodConfigDirty = true;
    });
    const moodPromptTextarea = doc.getElementById('bam-mood-prompt-template-textarea');
    moodPromptTextarea?.addEventListener('input', () => {
      this._moodPromptTemplateDraft = moodPromptTextarea.value;
      this._moodConfigDirty = true;
    });
    // 重新绑定注入角色切换
    const moodTab = doc.getElementById('bam-tab-mood');
    if (moodTab) {
      const roleRadios = moodTab.querySelectorAll('input[name="bam-injection-role"]');
      roleRadios.forEach(radio => {
        radio.addEventListener('change', () => {
          this._injectionRoleDraft = radio.value;
          this._moodConfigDirty = true;
        });
      });
    }
  }

  async _saveMoodConfig() {
    try {
      // 保存格式规则
      await this.db.setConfig('format_rule', this._formatRuleDraft);

      // 保存情绪词提示词模板
      await this.db.setConfig('mood_prompt_template', this._moodPromptTemplateDraft);

      // 保存注入角色配置
      await this.db.setConfig('injection_role', this._injectionRoleDraft);

      // 保存情绪配置
      const moodConfig = {
        version: '6.0',
        groups: this._moodConfigDraft.map(g => ({
          id: g.id,
          label: g.label,
          color: g.color,
          words: [...g.words],
        })),
      };
      await this.db.setConfig('mood_config', JSON.stringify(moodConfig));

      // 刷新注入缓存 + 重新注入
      invalidateInjectionCache();
      await applyInjection(this.db);

      // 刷新已展开的情绪差分面板（颜色色块同步）
      if (this._expandedMoodName) {
        await this._renderMoodPanel(this._expandedMoodName);
      }

      // 触发渲染预览刷新（情绪胶囊颜色同步）
      this._requestAvatarAssetPreviewRefresh();

      this._moodConfigDirty = false;
      const tipEl = this._getMainDocument().getElementById('bam-mood-save-tip');
      if (tipEl) tipEl.textContent = '✓ 已保存，格式规则和情绪词已同步更新到 AI 注入';
      setTimeout(() => {
        if (tipEl) tipEl.textContent = '修改后点击保存生效；保存后格式规则和情绪词将同步更新到 AI 注入';
      }, 3000);
    } catch (err) {
      console.error('保存情绪配置失败:', err);
      alert('保存失败: ' + err.message);
    }
  }
}


// ████████████████████████████████████████████████████████████
// █                                                        █
// █  Part 2.5: 格式规则 + 情绪词统一动态注入               █
// █                                                        █
// ████████████████████████████████████████████████████████████

const PROMPT_INJECTION_ID = 'bubble-dialogue-format-and-mood';
let _injectionHandle = null;
let _injectionCache = null;

/**
 * 从 IndexedDB 读取格式规则 + 情绪配置 + 情绪词提示词模板，构建注入文本
 * 格式规则从 config.format_rule 读取（用户可编辑）
 * 情绪配置从 config.mood_config 读取（用户可自定义）
 * 情绪词提示词模板从 config.mood_prompt_template 读取（用户可自定义，支持 {{mood_groups}} 占位符）
 * 首次读取后缓存到内存，配置修改后需调用 invalidateInjectionCache() 刷新
 */
async function buildInjectionPrompt(db) {
  if (_injectionCache) return _injectionCache;

  // 读取格式规则（可编辑文本）
  const formatRule = await db.getConfig('format_rule', null);
  const ruleText = (formatRule && typeof formatRule === 'string' && formatRule.trim())
    ? formatRule.trim()
    : DEFAULT_FORMAT_RULE;

  // 读取情绪配置
  const moodConfigRaw = await db.getConfig('mood_config', null);
  let groups;
  if (moodConfigRaw) {
    try {
      const parsed = JSON.parse(moodConfigRaw);
      groups = Array.isArray(parsed.groups) ? parsed.groups : DEFAULT_MOOD_GROUPS;
    } catch (e) {
      groups = DEFAULT_MOOD_GROUPS;
    }
  } else {
    groups = DEFAULT_MOOD_GROUPS;
  }

  // 读取情绪词提示词模板
  const moodPromptTemplate = await db.getConfig('mood_prompt_template', null);
  const template = (moodPromptTemplate && typeof moodPromptTemplate === 'string' && moodPromptTemplate.trim())
    ? moodPromptTemplate.trim()
    : DEFAULT_MOOD_PROMPT_TEMPLATE;

  // 构建情绪词分组文本
  let groupsText = '';
  for (const group of groups) {
    groupsText += `${group.label}组：${group.words.join('、')}\n`;
  }
  groupsText = groupsText.trimEnd();

  // 用模板渲染：替换 {{mood_groups}} 占位符
  const moodText = template.replace(/\{\{mood_groups\}\}/g, groupsText);

  // 合并：格式规则在前，情绪词约束在后
  _injectionCache = ruleText + '\n\n' + moodText;
  return _injectionCache;
}

/**
 * 刷新注入缓存（配置页保存后调用）
 */
function invalidateInjectionCache() {
  _injectionCache = null;
}

/**
 * 执行注入：优先使用酒馆助手 injectPrompts API，回退到酒馆原生 setExtensionPrompt
 * 三层降级：injectPrompts → setExtensionPrompt → 控制台警告
 */
async function applyInjection(db) {
  // 先清除旧注入
  if (_injectionHandle) {
    try { _injectionHandle.uninject(); } catch (_) {}
    _injectionHandle = null;
  }

  let content;
  try {
    content = await buildInjectionPrompt(db);
  } catch (err) {
    console.warn('[BubbleDialogue] 构建注入文本失败:', err);
    return;
  }

  if (!content) {
    console.warn('[BubbleDialogue] 注入内容为空，跳过注入');
    return;
  }

  // 读取注入角色配置
  let injectionRole = 'system';
  try {
    const savedRole = await db.getConfig('injection_role', null);
    if (savedRole === 'user') injectionRole = 'user';
  } catch (_) {}

  // 第一层：酒馆助手 injectPrompts API
  if (typeof injectPrompts === 'function') {
    try {
      _injectionHandle = injectPrompts([{
        id: PROMPT_INJECTION_ID,
        position: 'in_chat',
        depth: 0,
        role: injectionRole,
        content: content,
        should_scan: false,
      }]);
      console.log(`[BubbleDialogue] 格式规则+情绪词已通过 injectPrompts 注入 (role: ${injectionRole})`);
      return;
    } catch (err) {
      console.warn('[BubbleDialogue] injectPrompts 调用失败，尝试回退:', err);
    }
  }

  // 第二层：酒馆原生 setExtensionPrompt API
  try {
    const context = getCurrentContext();
    if (context && typeof context.setExtensionPrompt === 'function') {
      // setExtensionPrompt role: 0 = SYSTEM, 1 = USER
      const roleNum = (injectionRole === 'user') ? 1 : 0;
      context.setExtensionPrompt(
        'bubble-dialogue-format',
        content,
        0,    // position: IN_PROMPT
        0,    // depth: 0（紧贴最新）
        false, // scan: 不扫描世界书
        roleNum
      );
      console.log(`[BubbleDialogue] 格式规则+情绪词已通过 setExtensionPrompt 注入 (role: ${injectionRole})`);
      return;
    }
  } catch (err) {
    console.warn('[BubbleDialogue] setExtensionPrompt 调用失败:', err);
  }

  // 第三层：全部失败
  console.warn('[BubbleDialogue] ⚠ 格式规则注入未生效：injectPrompts 和 setExtensionPrompt 均不可用。请检查酒馆助手是否已安装。');
}


// ████████████████████████████████████████████████████████████
// █  Part 2.5: CG 图片库拉取引擎 + 公开 API                  █
// ████████████████████████████████████████████████████████████

async function parseAlbumUrl(input) {
  // 方式一：直接 URL 列表（多行，每行一个图片 URL，无需 fetch）
  const lines = input.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1 || (lines.length === 1 && IMAGE_EXTS_RE.test(lines[0]))) {
    const directUrls = lines.filter(l => /^https?:\/\//i.test(l) && IMAGE_EXTS_RE.test(l));
    if (directUrls.length > 0) return directUrls;
  }

  // 方式二/三：fetch URL → GitHub API / JSON 清单 / HTML 兜底
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CG_FETCH_TIMEOUT) : null;
  try {
    let resp;
    try {
      resp = await fetch(input, { signal: controller?.signal });
    } catch (fetchErr) {
      throw new Error(`无法访问该 URL（可能被 CORS 拦截）。\n建议改为直接粘贴图片 URL 列表（每行一个）。`);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = null; }

    if (json) {
      // GitHub Contents API 格式
      if (Array.isArray(json) && json.length && json[0].download_url && json[0].type) {
        return json
          .filter(item => item.type === 'file' && IMAGE_EXTS_RE.test(item.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map(item => item.download_url);
      }
      // 通用 JSON 清单：{images:[...]} 或纯数组
      const arr = Array.isArray(json) ? json : (Array.isArray(json.images) ? json.images : null);
      if (arr && arr.length && typeof arr[0] === 'string') {
        return arr.filter(u => typeof u === 'string' && IMAGE_EXTS_RE.test(u));
      }
    }

    // HTML 页面（catbox 等）：正则提取图片链接
    const urlPattern = /https?:\/\/[^\s"'<>]+?\.(webp|png|jpg|jpeg|gif|bmp|avif)(?=[?\s"'<>]|$)/gi;
    const allUrls = [...new Set(text.match(urlPattern) || [])];
    return allUrls.filter(u => IMAGE_EXTS_RE.test(u));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureCgGroupIndex(db, group) {
  const groupInfo = await db.getCgGroup(group);
  if (!groupInfo) throw new Error(`CG 组 "${group}" 未注册`);
  if (groupInfo.imageUrls && groupInfo.imageUrls.length > 0) return groupInfo;
  const urls = await parseAlbumUrl(groupInfo.albumUrl);
  if (!urls.length) throw new Error(`CG 组 "${group}" 清单为空`);
  await db.updateCgGroup(group, { imageUrls: urls, count: urls.length });
  return { ...groupInfo, imageUrls: urls, count: urls.length };
}

async function fetchCgImage(db, group, index) {
  const cached = await db.getCgImage(group, index);
  if (cached && cached.imageBlob) return cached.imageBlob;
  const groupInfo = await ensureCgGroupIndex(db, group);
  if (index < 1 || index > groupInfo.count) return null;
  const url = groupInfo.imageUrls[index - 1];
  if (!url) return null;
  const compOpts = await getCompressOptions(db);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CG_FETCH_TIMEOUT) : null;
  try {
    const resp = await fetch(url, { signal: controller?.signal });
    if (!resp.ok) return null;
    let blob = await resp.blob();
    blob = await compressImage(blob, compOpts);
    await db.putCgImage(group, index, blob, url);
    return blob;
  } catch (e) {
    console.warn(`[CG] 拉取 ${group}#${index} 失败:`, e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function preloadCgGroup(db, group, onProgress) {
  const groupInfo = await ensureCgGroupIndex(db, group);
  const compOpts = await getCompressOptions(db);
  let loaded = 0, skipped = 0, failed = 0;
  for (let i = 1; i <= groupInfo.count; i++) {
    const cached = await db.getCgImage(group, i);
    if (cached && cached.imageBlob) { skipped++; continue; }
    const url = groupInfo.imageUrls[i - 1];
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let blob = await resp.blob();
      blob = await compressImage(blob, compOpts);
      await db.putCgImage(group, i, blob, url);
      loaded++;
    } catch (_) { failed++; }
    if (onProgress) onProgress({ loaded, skipped, failed, total: groupInfo.count, current: i });
  }
  return { loaded, skipped, failed };
}

// ████████████████████████████████████████████████████████████
// █  Part 3: 初始化入口                                    █
// ████████████████████████████████████████████████████████████

const avatarDB = new AvatarDB();
const avatarManagerPanel = new AvatarManagerPanel(avatarDB);
window.avatarDB = avatarDB;
window.avatarManagerPanel = avatarManagerPanel;

// v7.0: CG 图片库公开 API
window.BubbleCG = {
  async getImage(group, index) {
    const cached = await avatarDB.getCgImage(group, index);
    if (cached && cached.imageBlob) return URL.createObjectURL(cached.imageBlob);
    const blob = await fetchCgImage(avatarDB, group, index);
    return blob ? URL.createObjectURL(blob) : null;
  },
  async getRandomImage(group) {
    const groupInfo = await ensureCgGroupIndex(avatarDB, group);
    if (!groupInfo || !groupInfo.count) return null;
    const index = Math.floor(Math.random() * groupInfo.count) + 1;
    return this.getImage(group, index);
  },
  async preloadGroup(group) {
    return preloadCgGroup(avatarDB, group);
  }
};
// 挂到所有可达的父级 window，让任意层级的 iframe 都能找到
try { if (window.parent && window.parent !== window) window.parent.BubbleCG = window.BubbleCG; } catch (_) {}
try { if (window.top && window.top !== window) window.top.BubbleCG = window.BubbleCG; } catch (_) {}

// v7.0: 头像公开 API
window.BubbleAvatar = {
  async getAvatar(name, charId) {
    const safeCharId = String(charId || getCurrentCharId() || GLOBAL_CHAR_ID);
    // 当前角色卡
    let record = await avatarDB.get(safeCharId, name);
    if (!record && safeCharId !== GLOBAL_CHAR_ID) {
      record = await avatarDB.get(GLOBAL_CHAR_ID, name);
    }
    if (!record) return null;
    if (record.imageBlob) return URL.createObjectURL(record.imageBlob);
    // 远程头像懒加载
    if (record.sourceUrl && record.sourceUrl !== 'null' && record.sourceUrl.startsWith('http')) {
      try {
        const resp = await fetch(record.sourceUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          record.imageBlob = blob; record.fileSize = blob.size; record.updatedAt = Date.now();
          await avatarDB._put(STORE_AVATARS, record);
          return URL.createObjectURL(blob);
        }
      } catch (_) {}
    }
    return null;
  },
  async getMoodAvatar(name, mood, charId) {
    const safeCharId = String(charId || getCurrentCharId() || GLOBAL_CHAR_ID);
    let moodId = mood;
    const group = MOOD_GROUPS.find(g => g.id === mood || g.label === mood);
    if (group) moodId = group.id;
    let record = await avatarDB.getMoodAvatar(safeCharId, name, moodId);
    if (!record && safeCharId !== GLOBAL_CHAR_ID) {
      record = await avatarDB.getMoodAvatar(GLOBAL_CHAR_ID, name, moodId);
    }
    if (!record) return null;
    if (record.imageBlob) return URL.createObjectURL(record.imageBlob);
    // 远程懒加载
    if (record.sourceUrl && record.sourceUrl !== 'null' && record.sourceUrl.startsWith('http')) {
      try {
        const resp = await fetch(record.sourceUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          record.imageBlob = blob; record.fileSize = blob.size; record.updatedAt = Date.now();
          await avatarDB._put(STORE_MOOD_AVATARS, record);
          return URL.createObjectURL(blob);
        }
      } catch (_) {}
    }
    return null;
  },
  async getColor(name, charId) {
    const safeCharId = String(charId || getCurrentCharId() || GLOBAL_CHAR_ID);
    const color = await avatarDB.getConfig(buildColorConfigKey(safeCharId, name), null);
    if (color) return color;
    if (safeCharId !== GLOBAL_CHAR_ID) {
      return avatarDB.getConfig(buildColorConfigKey(GLOBAL_CHAR_ID, name), null);
    }
    return null;
  }
};
try { if (window.parent && window.parent !== window) window.parent.BubbleAvatar = window.BubbleAvatar; } catch (_) {}
try { if (window.top && window.top !== window) window.top.BubbleAvatar = window.BubbleAvatar; } catch (_) {}

// v7.0: Live2D 公开 API（资源池全局，当前启用状态按角色卡隔离）
window.BubbleLive2D = {
  async getModelPackage(dir) {
    return avatarDB.getLive2DModelPackage(dir);
  },
  async getCurrentPackage(charId) {
    const current = await this.getCurrent(charId);
    const dir = current?.live2d?.dir;
    return dir ? this.getModelPackage(dir) : null;
  },
  async getCurrent(charId) {
    const safeCharId = String(charId || getCurrentCharId() || GLOBAL_CHAR_ID);
    const config = await avatarDB.getLive2DCharacterConfig(safeCharId);
    const dir = config.activeDir;
    if (!dir) return null;
    const models = await avatarDB.listLive2DModels();
    const model = models.find(item => item.dir === dir);
    if (!model) return null;
    return {
      name: dir,
      live2d: {
        dir,
        jsonPath: `indexeddb://${dir}/normal/model.json`,
        version: model.version || String(Date.now()),
        hasDestroy: !!model.hasDestroy
      }
    };
  },
  async list(charId) {
    const safeCharId = String(charId || getCurrentCharId() || GLOBAL_CHAR_ID);
    const [config, models] = await Promise.all([
      avatarDB.getLive2DCharacterConfig(safeCharId),
      avatarDB.listLive2DModels()
    ]);
    const modelMap = new Map(models.map(model => [model.dir, model]));
    return Object.keys(config.models || {}).map(dir => modelMap.get(dir)).filter(Boolean);
  }
};
try { if (window.parent && window.parent !== window) window.parent.BubbleLive2D = window.BubbleLive2D; } catch (_) {}
try { if (window.top && window.top !== window) window.top.BubbleLive2D = window.BubbleLive2D; } catch (_) {}

function injectWandMenuItem() {
  // 尝试获取酒馆主页面 document（脚本可能跑在 iframe 里）
  let doc;
  const candidates = [];
  try { if (window.top && window.top.document) candidates.push(window.top.document); } catch (_) {}
  try { if (window.parent && window.parent.document && window.parent.document !== document) candidates.push(window.parent.document); } catch (_) {}
  candidates.push(document);

  let menu = null;
  for (const d of candidates) {
    try {
      menu = d.getElementById('extensionsMenu')
        || d.getElementById('extensions_menu')
        || d.querySelector('#extensionsMenu')
        || d.querySelector('.extensions_block .list-group');
      if (menu) { doc = d; break; }
    } catch (_) {}
  }

  if (!menu) {
    setTimeout(injectWandMenuItem, 1000);
    return;
  }
  // 旧按钮残留（事件可能已失效）→ 删掉重建
  const oldBtn = doc.getElementById('bubble-avatar-wand-btn');
  if (oldBtn) oldBtn.remove();

  const mi = doc.createElement('a');
  mi.id = 'bubble-avatar-wand-btn';
  mi.className = 'list-group-item';
  mi.href = 'javascript:void(0)';
  mi.innerHTML = '<span class="fa-solid fa-comments"></span> 对话气泡';
  mi.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    avatarManagerPanel.open().catch(err => {
      console.error('[BubbleDialogue] open() 失败:', err);
    });
    try { menu.parentElement?.click?.(); } catch (_) {}
  });
  menu.appendChild(mi);
}

$(() => {
  // 注册酒馆助手按钮事件（可能尚未加载，用 try-catch 保护）
  try {
    if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
      eventOn(getButtonEvent('对话气泡'), () => {
        avatarManagerPanel.open().catch(err => console.error('[BubbleDialogue] open() 失败:', err));
      });
    }
  } catch (e) {
    console.warn('[BubbleDialogue] 酒馆助手按钮事件注册失败:', e);
  }

  avatarDB.init().then(() => {
    // DB 就绪后立即执行首次注入
    applyInjection(avatarDB);
  }).catch((err) => {
    console.warn('[BubbleDialogue] DB 初始化失败:', err);
  });

  injectWandMenuItem();
  // v7.0: 定期重注入魔法棒按钮（酒馆菜单重建或脚本热重载时旧按钮事件会失效）
  setInterval(injectWandMenuItem, 5000);

  // 监听聊天切换事件，重新注入（injectPrompts 注入仅在当前聊天有效）
  try {
    if (typeof tavern_events !== 'undefined' && tavern_events.CHAT_CHANGED) {
      eventOn(tavern_events.CHAT_CHANGED, () => {
        invalidateInjectionCache();
        applyInjection(avatarDB);
      });
    }
  } catch (e) {
    console.warn('[BubbleDialogue] 无法监听 CHAT_CHANGED 事件:', e);
  }
});
$(window).on('pagehide', () => { avatarDB.revokeAllUrls(); });
