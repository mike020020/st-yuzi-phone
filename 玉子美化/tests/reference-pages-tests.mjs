import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const pagesRoot = new URL('../references/pages/', import.meta.url);
const PAGE_FILES = Object.freeze(['README.md', 'index.html', 'mount.js', 'style.css']);
const MALICIOUS_TEXT = '<img src=x onerror=alert(1)>';

function dataKey(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class FakeClassList {
  constructor(node) { this.node = node; }
  values() { return this.node.className.split(/\s+/).filter(Boolean); }
  contains(token) { return this.values().includes(token); }
  toggle(token, force) {
    const tokens = new Set(this.values());
    const enabled = force === undefined ? !tokens.has(token) : Boolean(force);
    if (enabled) tokens.add(token); else tokens.delete(token);
    this.node.className = [...tokens].join(' ');
    return enabled;
  }
}

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = String(tagName).toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.disabled = false;
    this.hidden = false;
    this.type = '';
    this._text = '';
    this._listeners = new Map();
    this.listenerAdds = new Map();
    this.listenerRemoves = new Map();
  }

  get classList() { return new FakeClassList(this); }
  get textContent() { return `${this._text}${this.children.map(child => child.textContent).join('')}`; }
  set textContent(value) {
    this._text = String(value ?? '');
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
  }

  append(...nodes) {
    nodes.forEach((node) => {
      assert.ok(node instanceof FakeElement, '假 DOM 只接受元素节点');
      node.parentNode = this;
      this.children.push(node);
    });
  }

  replaceChildren(...nodes) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'class') this.className = normalized;
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = normalized;
  }

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return Object.hasOwn(this.dataset, dataKey(name)) ? String(this.dataset[dataKey(name)]) : null;
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(',').map(part => part.trim()).filter(Boolean).some((part) => {
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attribute) {
        const [, name, expected] = attribute;
        const actual = this.getAttribute(name);
        return expected === undefined ? actual !== null : actual === expected;
      }
      return this.tagName === part.toUpperCase();
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) result.push(child);
        visit(child);
      });
    };
    visit(this);
    return result;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(listener);
    this.listenerAdds.set(type, (this.listenerAdds.get(type) || 0) + 1);
  }

  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
    this.listenerRemoves.set(type, (this.listenerRemoves.get(type) || 0) + 1);
  }

  async dispatch(type, target) {
    for (const listener of [...(this._listeners.get(type) || [])]) await listener({ target });
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(this, tagName); }
}

function makeStaticPage(pageName, rootClass) {
  const doc = new FakeDocument();
  const root = doc.createElement('section');
  root.className = rootClass.slice(1);
  root.setAttribute('data-yb-reference', pageName);
  const header = doc.createElement('header');
  const actions = new Map();
  for (const [action, label] of [['back', '返回'], ['previousTable', '上一张'], ['nextTable', '下一张'], ['editCurrentTable', '编辑']]) {
    const button = doc.createElement('button');
    button.textContent = label;
    button.dataset.runtimeAction = action;
    actions.set(action, button);
    header.append(button);
  }
  const title = doc.createElement('strong');
  title.setAttribute('data-page-title', '');
  header.children.splice(2, 0, title);
  title.parentNode = header;
  const status = doc.createElement('p');
  status.setAttribute('data-action-status', '');
  const content = doc.createElement('main');
  content.setAttribute('data-page-content', '');
  root.append(header, status, content);
  const result = { root, title, status, content, actions };
  if (pageName === 'square') {
    const detail = doc.createElement('aside');
    detail.setAttribute('data-square-detail', '');
    detail.hidden = true;
    const detailTitle = doc.createElement('strong');
    detailTitle.setAttribute('data-square-detail-title', '');
    const close = doc.createElement('button');
    close.setAttribute('data-square-detail-close', '');
    const detailBody = doc.createElement('p');
    detailBody.setAttribute('data-square-detail-body', '');
    detail.append(detailTitle, close, detailBody);
    root.append(detail);
    Object.assign(result, { detail, detailTitle, detailBody, detailClose: close });
  }
  return result;
}

function ordinarySelectors(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const result = [];
  let buffer = '';
  let quote = '';
  let escaped = false;
  for (const character of source) {
    if (quote) {
      buffer += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === '{') {
      const prelude = buffer.trim();
      if (prelude && !prelude.startsWith('@')) result.push(...prelude.split(',').map(value => value.trim()).filter(Boolean));
      buffer = '';
      continue;
    }
    if (character === '}') {
      buffer = '';
      continue;
    }
    buffer += character;
  }
  return result;
}

const configs = Object.freeze({
  calendar: {
    rootClass: '.yb-calendar-page',
    state: {
      version: 1,
      tableName: '小日历表',
      headers: ['日期', '月份几天', '星期几', '节日', '大事件', '状态', '天气', '与今天的关系', '内容'],
      rows: [
        ['2026-7-27', '31', '一', '夏日祭', '去看烟火', '进行中', '晴', '今天', MALICIOUS_TEXT],
        ['2026-7-28', '31', '二', '', '整理照片', '待办', '多云', '明天', '记得备份'],
      ],
      canPrevious: true,
      canNext: false,
    },
    async verify(page, publish) {
      const before = page.content.querySelector('.yb-calendar-page__month-label').textContent;
      await page.root.dispatch('click', page.content.querySelector('[data-calendar-action="next-month"]'));
      const after = page.content.querySelector('.yb-calendar-page__month-label').textContent;
      assert.notEqual(after, before, '小日历应能切换月份');
      publish({
        tableName: '抽象纪年日历',
        rows: [['星历-花月-二十七', '30', '一', '花朝', '观星', '进行中', '晴', '今天', '抽象日期内容']],
      });
      assert.match(page.content.textContent, /星历-花月-二十七/, '小日历应解析抽象纪年日期');
      assert.match(page.content.textContent, /抽象日期内容/);
    },
  },
  diary: {
    rootClass: '.yb-diary-page',
    state: {
      version: 1,
      tableName: '小日记表',
      headers: ['row_id', '日期', '角色', '内容'],
      rows: Array.from({ length: 6 }, (_value, index) => [
        index + 1,
        `第${index + 1}日`,
        `角色${index + 1}`,
        index === 0 ? `正文 ~~${MALICIOUS_TEXT}~~\nPS: 补记\nPPS：再补` : `第${index + 1}篇日记`,
      ]),
      canPrevious: true,
      canNext: false,
    },
    async verify(page) {
      assert.equal(page.content.querySelectorAll('.yb-diary-page__card').length, 5, '小日记最多展示五条');
      assert.equal(page.content.querySelectorAll('.yb-diary-page__secret').length, 1, '小日记应解析秘密标记');
      assert.match(page.content.textContent, /PS补记PPS再补/, '小日记应解析 PS 与 PPS');
    },
  },
  live: {
    rootClass: '.yb-live-page',
    state: {
      version: 1,
      tableName: '直播表',
      headers: ['直播间名', '领衔阵容', '阵容标签', '直播标题', '剧情舞台概述', '对手戏看点', '观看/互动数据', '时间文本', '剧情弹幕串', '推角弹幕串', '对线弹幕串'],
      rows: [['雨夜剧场', '玉子 / 阿遥', '限定场', '雨幕重逢', MALICIOUS_TEXT, '伞下对峙', '观看 1.2万;点赞 860', '21:30', '观众甲：终于开场了', '玉子推：今天也好看', '路人：先别吵']],
      canPrevious: true,
      canNext: false,
    },
    async verify(page) {
      assert.equal(page.content.querySelectorAll('.yb-live-page__barrage').length, 3, '直播页应合并三类弹幕');
      const toggle = page.content.querySelector('[data-barrage-toggle]');
      const room = toggle.closest('.yb-live-page__room');
      await page.root.dispatch('click', toggle);
      assert.equal(room.classList.contains('is-barrage-hidden'), true, '直播页应逐房间隐藏弹幕');
      assert.equal(toggle.textContent, '显示弹幕');
    },
  },
  square: {
    rootClass: '.yb-square-page',
    state: {
      version: 1,
      tableName: '广场表',
      headers: ['帖子ID', '发帖账号名', '账号标签', '帖子标题', '帖子正文', '话题/附加信息', '图片描述', '视频描述', '互动数据', '时间文本', '评论串'],
      rows: [['p-1', '玉子', '日常', '午后散步', MALICIOUS_TEXT, '散步;晴天', '树影落在石阶上', 'none', '12赞 · 3评', '刚刚', '阿遥：好天气;小葵：下次一起']],
      canPrevious: true,
      canNext: false,
    },
    async verify(page) {
      await page.root.dispatch('click', page.content.querySelector('[data-square-media]'));
      assert.equal(page.detail.hidden, false, '广场媒体说明应在根内打开');
      assert.equal(page.detailBody.textContent, '树影落在石阶上');
      await page.root.dispatch('click', page.detailClose);
      assert.equal(page.detail.hidden, true, '广场媒体说明应可关闭');
    },
  },
  forum: {
    rootClass: '.yb-forum-page',
    state: {
      version: 1,
      tableName: '论坛表',
      headers: ['分区/版面名', '发帖账号名', '账号标签', '帖子标题', '帖子正文', '附加信息', '热度/回应数据', '时间文本', '评论串'],
      rows: [
        ['闲聊区', '海盐汽水', '常驻', 'A', MALICIOUS_TEXT, '日常;讨论', '热度 321 · 回应 2', '10分钟前', '一楼：先占位;二楼：慢慢说'],
        ['问答区', '薄荷糖', '新人', 'B', '求推荐', '求助', '回应 4', '8分钟前', '热心人：可以试试'],
        ['分享区', '纸飞机', '活跃', 'C', '今日照片', '摄影', '回应 6', '5分钟前', '看客：拍得真好'],
        ['闲聊区', '晚风', '常驻', 'D', '睡前闲聊', '夜话', '回应 3', '刚刚', '夜猫子：还没睡'],
      ],
      canPrevious: true,
      canNext: false,
    },
    async verify(page) {
      const covers = page.content.querySelectorAll('.yb-forum-page__cover');
      for (const tone of ['mist', 'cream', 'sage', 'rose']) assert.ok(covers.some(cover => cover.classList.contains(`tone-${tone}`)), `论坛页应实际渲染 ${tone} 封面`);
      const toggle = page.content.querySelector('[data-forum-replies]');
      const replies = toggle.closest('.yb-forum-page__thread').querySelector('.yb-forum-page__replies');
      assert.equal(replies.hidden, false);
      await page.root.dispatch('click', toggle);
      assert.equal(replies.hidden, true, '论坛评论串应可折叠');
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    },
  },
});

const forbiddenSourcePatterns = Object.freeze([
  [/\bimport\b/, 'module import'],
  [/\.\.\//, '父目录引用'],
  [/phone/i, '玉子手机标识'],
  [/AutoCardUpdaterAPI/, '数据库全局对象'],
  [/TavernHelper/, '酒馆助手全局对象'],
  [/SillyTavern\.getContext/, 'SillyTavern 全局入口'],
  [/\b(?:window|globalThis)\b/, '外部全局对象'],
  [/\bdocument\s*[.[]/, '全局 document'],
  [/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b/, '外部读写入口'],
  [/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/, 'HTML 字符串注入'],
  [/\b(?:executeSlashCommands|insertRow|deleteRow|removeRow|updateTable|replaceTable|writeTable|generateText|worldbook)\b/i, '越界写入或生成能力'],
  [/[世][界][书]/, '世界书能力'],
]);

for (const [pageName, config] of Object.entries(configs)) {
  const pageUrl = new URL(`${pageName}/`, pagesRoot);
  const files = (await fs.readdir(pageUrl)).sort();
  assert.deepEqual(files, [...PAGE_FILES].sort(), `${pageName} 目录应且只应包含四个参考文件`);
  await assert.rejects(fs.access(new URL('project.json', pageUrl)), `${pageName} 不得提供 project.json`);

  const [html, css, source] = await Promise.all([
    fs.readFile(new URL('index.html', pageUrl), 'utf8'),
    fs.readFile(new URL('style.css', pageUrl), 'utf8'),
    fs.readFile(new URL('mount.js', pageUrl), 'utf8'),
  ]);
  assert.match(html, new RegExp(`class="${config.rootClass.slice(1)}"`), `${pageName} HTML 根类错误`);
  assert.match(html, /data-page-content/);
  for (const action of ['back', 'previousTable', 'nextTable', 'editCurrentTable']) assert.match(html, new RegExp(`data-runtime-action="${action}"`));
  const selectors = ordinarySelectors(css);
  assert.ok(selectors.length > 0, `${pageName} CSS 必须包含实际样式规则`);
  for (const selector of selectors) assert.ok(selector.startsWith(config.rootClass), `${pageName} CSS 选择器越出根作用域：${selector}`);

  assert.match(source, /export function mount\(context\)/, `${pageName} 必须显式导出 mount(context)`);
  for (const [pattern, label] of forbiddenSourcePatterns) assert.doesNotMatch(source, pattern, `${pageName} mount.js 含${label}`);
  const members = [...source.matchAll(/\bcontext(?:\?\.|\.)([A-Za-z_$][\w$]*)/g)].map(match => match[1]);
  for (const member of members) assert.ok(['root', 'getState', 'subscribe', 'actions'].includes(member), `${pageName} 使用未批准的 context.${member}`);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const pageModule = await import(moduleUrl);
  assert.equal(typeof pageModule.mount, 'function');
  const page = makeStaticPage(pageName, config.rootClass);
  let state = structuredClone(config.state);
  let subscriber = null;
  let unsubscribeCalls = 0;
  const actionCalls = [];
  const context = {
    root: page.root,
    getState: () => state,
    subscribe(listener) {
      subscriber = listener;
      return () => { unsubscribeCalls += 1; if (subscriber === listener) subscriber = null; };
    },
    actions: Object.fromEntries(['back', 'previousTable', 'nextTable', 'editCurrentTable'].map(action => [action, async () => {
      actionCalls.push(action);
      return { ok: true, action, status: 'navigated' };
    }])),
  };
  const dispose = pageModule.mount(context);
  assert.equal(typeof dispose, 'function', `${pageName} 必须返回 disposer`);
  assert.equal(page.title.textContent, config.state.tableName);
  assert.ok(page.content.children.length > 0, `${pageName} 初次挂载应生成内容`);
  assert.match(page.content.textContent, /<img src=x onerror=alert\(1\)>/, `${pageName} 应保留恶意样本文本`);
  assert.equal(page.root.querySelectorAll('img').length, 0, `${pageName} 不得把恶意文本解析成元素`);
  assert.equal(page.actions.get('previousTable').disabled, false);
  assert.equal(page.actions.get('nextTable').disabled, true);

  const initialFirstChild = page.content.children[0];
  state = { ...state, version: state.version + 1, tableName: `${state.tableName} · 已更新` };
  subscriber(state, { reason: 'table-data' });
  assert.equal(page.title.textContent, state.tableName, `${pageName} 应响应 subscribe`);
  assert.notEqual(page.content.children[0], initialFirstChild, `${pageName} subscribe 应重绘内容`);

  await page.root.dispatch('click', page.actions.get('back'));
  assert.deepEqual(actionCalls, ['back'], `${pageName} 顶栏应调用 Runtime action`);
  assert.equal(page.status.textContent, '返回请求已提交');
  await config.verify(page, (patch) => {
    state = { ...state, ...patch, version: state.version + 1 };
    subscriber(state, { reason: 'table-data' });
  });

  dispose();
  dispose();
  assert.equal(page.root.listenerAdds.get('click'), 1, `${pageName} 应只注册一个根 click listener`);
  assert.equal(page.root.listenerRemoves.get('click'), 1, `${pageName} disposer 必须幂等解绑`);
  assert.equal(unsubscribeCalls, 1, `${pageName} disposer 必须幂等退订`);
  assert.equal(subscriber, null);
}

console.log('[reference-pages-tests] 通过');
