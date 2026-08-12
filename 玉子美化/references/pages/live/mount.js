const ACTION_LABELS = Object.freeze({ back: '返回', previousTable: '上一张', nextTable: '下一张', editCurrentTable: '编辑' });
const TONES = Object.freeze(['rose', 'blue', 'violet', 'gold', 'mint']);
const MARKS = Object.freeze(['✦', '◇', '♕', '☂', '♪', '✧']);
const INDENTS = Object.freeze([0, 2, 1, 3, 0, 1, 2, 4, 1, 3]);
const BARRAGE_FIELDS = Object.freeze([
  Object.freeze({ header: '剧情弹幕串', kind: '剧情' }),
  Object.freeze({ header: '推角弹幕串', kind: '推角' }),
  Object.freeze({ header: '对线弹幕串', kind: '对线' }),
]);

function text(value) { return String(value ?? '').trim(); }
function splitList(value) { const source = text(value); return !source || source.toLowerCase() === 'none' ? [] : source.replace(/；/g, ';').split(';').map(text).filter(Boolean); }

function hashIndex(value, modulo) {
  let hash = 0;
  for (const character of String(value ?? '')) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % modulo;
}

function element(doc, tag, className = '', value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function rowsFromState(state) {
  const headers = Array.isArray(state?.headers) ? state.headers.map(text) : [];
  return (Array.isArray(state?.rows) ? state.rows : []).filter(Array.isArray).map((row) => {
    const result = new Map();
    headers.forEach((header, index) => { if (header && !result.has(header)) result.set(header, row[index]); });
    return result;
  });
}

function cell(row, name, fallback = '') { return row.has(name) ? row.get(name) : fallback; }

function parseBarrage(value, kind, fieldIndex) {
  return splitList(value).map((segment, itemIndex) => {
    const separator = segment.search(/[:：]/);
    const badge = separator < 0 ? '观众' : text(segment.slice(0, separator)) || '观众';
    const body = separator < 0 ? segment : text(segment.slice(separator + 1)) || '（空弹幕）';
    const seed = `${badge}|${kind}|${body}|${fieldIndex}|${itemIndex}`;
    return { badge, body, kind, tone: TONES[hashIndex(badge, TONES.length)], mark: MARKS[hashIndex(seed, MARKS.length)], indent: INDENTS[(hashIndex(seed, INDENTS.length) + itemIndex) % INDENTS.length] };
  });
}

function actionMessage(action, result) {
  if (result?.ok) return `${ACTION_LABELS[action]}请求已提交`;
  if (result?.status === 'unavailable') return `${ACTION_LABELS[action]}不可用`;
  if (result?.status === 'stale') return '页面已失效';
  return result?.message || `${ACTION_LABELS[action]}失败`;
}

export function mount(context) {
  const root = context?.root;
  if (!root || typeof context.getState !== 'function' || typeof context.subscribe !== 'function') throw new Error('直播参考页需要 Runtime API v1 context');
  const doc = root.ownerDocument;
  const content = root.querySelector('[data-page-content]');
  const title = root.querySelector('[data-page-title]');
  const status = root.querySelector('[data-action-status]');
  if (!doc || !content) throw new Error('直播入口缺少 data-page-content');
  let disposed = false;
  const hiddenRooms = new Set();

  const render = (state = context.getState()) => {
    if (disposed) return;
    if (title) title.textContent = state?.tableName || '直播';
    const previous = root.querySelector('[data-runtime-action="previousTable"]');
    const next = root.querySelector('[data-runtime-action="nextTable"]');
    if (previous) previous.disabled = !state?.canPrevious;
    if (next) next.disabled = !state?.canNext;
    const rooms = rowsFromState(state).map((row, rowIndex) => {
      const name = text(cell(row, '直播间名')) || `直播间 ${rowIndex + 1}`;
      const time = text(cell(row, '时间文本'));
      return {
        key: `${name}|${rowIndex}`,
        name,
        lineup: text(cell(row, '领衔阵容')),
        tag: text(cell(row, '阵容标签')),
        streamTitle: text(cell(row, '直播标题')),
        summary: text(cell(row, '剧情舞台概述')),
        focus: text(cell(row, '对手戏看点')),
        metrics: splitList(cell(row, '观看/互动数据')),
        time,
        barrages: BARRAGE_FIELDS.flatMap((field, fieldIndex) => parseBarrage(cell(row, field.header), field.kind, rowIndex + fieldIndex)),
      };
    });
    if (rooms.length === 0) { content.replaceChildren(element(doc, 'div', 'yb-live-page__empty', '暂无直播间内容')); return; }
    const roomNodes = rooms.map((room) => {
      const hidden = hiddenRooms.has(room.key);
      const article = element(doc, 'article', `yb-live-page__room${hidden ? ' is-barrage-hidden' : ''}`);
      article.dataset.roomKey = room.key;
      if (room.metrics.length > 0 || room.time) {
        const strip = element(doc, 'section', 'yb-live-page__status');
        room.metrics.slice(0, 4).forEach(metric => strip.append(element(doc, 'span', 'yb-live-page__stat', metric)));
        if (room.time) strip.append(element(doc, 'span', 'yb-live-page__stat is-time', `◷ ${room.time}`));
        article.append(strip);
      }
      const hero = element(doc, 'section', 'yb-live-page__hero');
      const poster = element(doc, 'div', 'yb-live-page__poster');
      poster.setAttribute('aria-hidden', 'true');
      poster.append(element(doc, 'span', 'yb-live-page__rain is-a'), element(doc, 'span', 'yb-live-page__rain is-b'), element(doc, 'span', 'yb-live-page__rain is-c'), element(doc, 'span', 'yb-live-page__umbrella'));
      const caption = element(doc, 'span', 'yb-live-page__poster-caption');
      caption.append(element(doc, 'span', '', 'Rainy'), element(doc, 'strong', '', 'Night'));
      poster.append(caption, element(doc, 'span', 'yb-live-page__poster-title', room.streamTitle || room.name));
      hero.append(poster);
      const heroContent = element(doc, 'div', 'yb-live-page__hero-content');
      const kicker = element(doc, 'div', 'yb-live-page__kicker');
      kicker.append(element(doc, 'span', '', '剧场直播'), element(doc, 'span', 'yb-live-page__gift', '🎁 应援榜'));
      heroContent.append(kicker, element(doc, 'h2', 'yb-live-page__title', room.streamTitle || room.name));
      if (room.lineup) heroContent.append(element(doc, 'div', 'yb-live-page__cast', room.lineup));
      if (room.tag) heroContent.append(element(doc, 'span', 'yb-live-page__chip', room.tag));
      if (room.summary) { const value = element(doc, 'p', 'yb-live-page__summary'); value.append(element(doc, 'strong', '', '剧情简介：'), element(doc, 'span', '', room.summary)); heroContent.append(value); }
      if (room.focus) { const value = element(doc, 'p', 'yb-live-page__focus'); value.append(element(doc, 'strong', '', '☆ 本场看点：'), element(doc, 'span', '', room.focus)); heroContent.append(value); }
      hero.append(heroContent);
      article.append(hero);
      const wall = element(doc, 'section', 'yb-live-page__barrage-wall');
      wall.append(element(doc, 'h3', 'yb-live-page__barrage-title', '弹幕热议'));
      if (room.barrages.length === 0) wall.append(element(doc, 'div', 'yb-live-page__empty', '暂无弹幕'));
      else {
        const list = element(doc, 'ul', 'yb-live-page__barrage-list');
        room.barrages.forEach((item) => {
          const row = element(doc, 'li', `yb-live-page__barrage tone-${item.tone}`);
          row.dataset.indent = String(item.indent);
          row.append(element(doc, 'span', 'yb-live-page__badge', item.badge), element(doc, 'span', '', '：'), element(doc, 'span', 'yb-live-page__barrage-text', item.body), element(doc, 'span', '', item.mark));
          list.append(row);
        });
        wall.append(list);
      }
      article.append(wall);
      const controls = element(doc, 'footer', 'yb-live-page__controls');
      controls.append(element(doc, 'span', 'yb-live-page__input', '说点什么…'));
      const toggle = element(doc, 'button', 'yb-live-page__toggle', hidden ? '显示弹幕' : '暂停弹幕');
      toggle.type = 'button';
      toggle.dataset.barrageToggle = room.key;
      toggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      controls.append(toggle);
      article.append(controls);
      return article;
    });
    content.replaceChildren(...roomNodes);
  };

  const handleClick = async (event) => {
    const actionButton = event.target?.closest?.('[data-runtime-action]');
    if (actionButton) {
      const action = actionButton.dataset.runtimeAction;
      const handler = context.actions?.[action];
      if (disposed || typeof handler !== 'function') return;
      actionButton.disabled = true;
      try { const result = await handler(); if (!disposed && status) status.textContent = actionMessage(action, result); }
      catch (error) { if (!disposed && status) status.textContent = text(error?.message) || `${ACTION_LABELS[action]}失败`; }
      finally { if (!disposed && !['previousTable', 'nextTable'].includes(action)) actionButton.disabled = false; }
      return;
    }
    const toggle = event.target?.closest?.('[data-barrage-toggle]');
    if (!toggle || disposed) return;
    const key = text(toggle.dataset.barrageToggle);
    const room = toggle.closest?.('.yb-live-page__room');
    if (!key || !room) return;
    const hidden = !hiddenRooms.has(key);
    if (hidden) hiddenRooms.add(key); else hiddenRooms.delete(key);
    room.classList.toggle('is-barrage-hidden', hidden);
    toggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    toggle.textContent = hidden ? '显示弹幕' : '暂停弹幕';
  };

  root.addEventListener('click', handleClick);
  const unsubscribe = context.subscribe(render);
  render();
  return () => {
    if (disposed) return;
    disposed = true;
    root.removeEventListener('click', handleClick);
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}
