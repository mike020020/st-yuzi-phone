const ACTION_LABELS = Object.freeze({ back: '返回', previousTable: '上一张', nextTable: '下一张', editCurrentTable: '编辑' });
const MAX_ENTRIES = 5;
const DEFAULT_DATE = '昨日私语';
const POSTSCRIPT = /^\s*(PS|PPS)\s*[：:]/i;
const INLINE_POSTSCRIPT = /(^|\s)(PS|PPS)\s*[：:]/ig;

function text(value) { return String(value ?? '').trim(); }
function normalizeContent(value) { return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(); }

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

function inlineMarkers(line) {
  const markers = [];
  INLINE_POSTSCRIPT.lastIndex = 0;
  let match = INLINE_POSTSCRIPT.exec(line);
  while (match) {
    const prefix = match[1] || '';
    markers.push({ kind: match[2].toUpperCase(), start: match.index + prefix.length, bodyStart: INLINE_POSTSCRIPT.lastIndex });
    match = INLINE_POSTSCRIPT.exec(line);
  }
  return markers;
}

function tokens(value) {
  const source = String(value ?? '');
  const result = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('~~', cursor);
    if (open < 0) { result.push({ kind: 'text', value: source.slice(cursor) }); break; }
    const close = source.indexOf('~~', open + 2);
    if (close < 0) { result.push({ kind: 'text', value: source.slice(cursor) }); break; }
    if (open > cursor) result.push({ kind: 'text', value: source.slice(cursor, open) });
    result.push({ kind: 'secret', value: source.slice(open + 2, close) });
    cursor = close + 2;
  }
  return result.filter(token => token.value !== '');
}

function pushLine(target, kind, value) {
  const normalized = text(value);
  if (normalized) target.push({ kind, tokens: tokens(normalized) });
}

function splitInline(line, main, postscripts) {
  const markers = inlineMarkers(line);
  if (markers.length === 0) { pushLine(main, 'main', line); return; }
  pushLine(main, 'main', line.slice(0, markers[0].start));
  markers.forEach((marker, index) => pushLine(postscripts, marker.kind, line.slice(marker.bodyStart, markers[index + 1]?.start ?? line.length)));
}

function parseContent(value) {
  const source = normalizeContent(value);
  const main = [];
  const postscripts = [];
  if (!source) return { main, postscripts };
  source.split('\n').forEach((line) => {
    if (!text(line)) return;
    const match = POSTSCRIPT.exec(line);
    if (!match) { splitInline(line, main, postscripts); return; }
    const body = line.slice(match[0].length);
    const markers = inlineMarkers(body);
    if (markers.length === 0) { pushLine(postscripts, match[1].toUpperCase(), body); return; }
    pushLine(postscripts, match[1].toUpperCase(), body.slice(0, markers[0].start));
    markers.forEach((marker, index) => pushLine(postscripts, marker.kind, body.slice(marker.bodyStart, markers[index + 1]?.start ?? body.length)));
  });
  return { main, postscripts };
}

function appendTokens(doc, parent, tokenList) {
  tokenList.forEach((token) => parent.append(element(doc, 'span', token.kind === 'secret' ? 'yb-diary-page__secret' : '', token.value)));
}

function actionMessage(action, result) {
  if (result?.ok) return `${ACTION_LABELS[action]}请求已提交`;
  if (result?.status === 'unavailable') return `${ACTION_LABELS[action]}不可用`;
  if (result?.status === 'stale') return '页面已失效';
  return result?.message || `${ACTION_LABELS[action]}失败`;
}

export function mount(context) {
  const root = context?.root;
  if (!root || typeof context.getState !== 'function' || typeof context.subscribe !== 'function') throw new Error('小日记需要 Runtime API v1 context');
  const doc = root.ownerDocument;
  const content = root.querySelector('[data-page-content]');
  const title = root.querySelector('[data-page-title]');
  const status = root.querySelector('[data-action-status]');
  if (!doc || !content) throw new Error('小日记入口缺少 data-page-content');
  let disposed = false;

  const render = (state = context.getState()) => {
    if (disposed) return;
    if (title) title.textContent = state?.tableName || '小日记';
    const previous = root.querySelector('[data-runtime-action="previousTable"]');
    const next = root.querySelector('[data-runtime-action="nextTable"]');
    if (previous) previous.disabled = !state?.canPrevious;
    if (next) next.disabled = !state?.canNext;
    const entries = rowsFromState(state).map((row, index) => {
      const body = normalizeContent(cell(row, '内容'));
      if (!body) return null;
      const character = text(cell(row, '角色')) || '匿名日记主人';
      return { id: text(cell(row, 'row_id')) || `entry_${index + 1}`, date: text(cell(row, '日期')), character, avatar: [...character][0] || '记', parsed: parseContent(body) };
    }).filter(Boolean).slice(0, MAX_ENTRIES);
    if (entries.length === 0) {
      const empty = element(doc, 'section', 'yb-diary-page__empty');
      empty.append(element(doc, 'strong', '', '暂无小日记内容'), element(doc, 'span', '', '等角色把昨日的秘密写下来，这里会变成一叠暖白色的私人手帐。'));
      content.replaceChildren(empty);
      return;
    }
    const cards = entries.map((entry) => {
      const card = element(doc, 'article', 'yb-diary-page__card');
      card.dataset.diaryEntry = entry.id;
      card.append(element(doc, 'span', 'yb-diary-page__pin'));
      const head = element(doc, 'header', 'yb-diary-page__card-head');
      head.append(element(doc, 'span', 'yb-diary-page__date', entry.date || DEFAULT_DATE), element(doc, 'span', 'yb-diary-page__private', 'PRIVATE'));
      card.append(head);
      const authorRow = element(doc, 'div', 'yb-diary-page__author-row');
      authorRow.append(element(doc, 'span', 'yb-diary-page__avatar', entry.avatar));
      const authorBlock = element(doc, 'div');
      authorBlock.append(element(doc, 'h3', 'yb-diary-page__author', entry.character), element(doc, 'div', 'yb-diary-page__signature', '写给自己的日记'));
      authorRow.append(authorBlock);
      card.append(authorRow);
      const body = element(doc, 'div', 'yb-diary-page__body');
      entry.parsed.main.forEach((line) => { const paragraph = element(doc, 'p', 'yb-diary-page__line'); appendTokens(doc, paragraph, line.tokens); body.append(paragraph); });
      card.append(body);
      if (entry.parsed.postscripts.length > 0) {
        const postscript = element(doc, 'footer', 'yb-diary-page__postscript');
        entry.parsed.postscripts.forEach((line) => {
          const row = element(doc, 'div', 'yb-diary-page__postscript-line');
          row.append(element(doc, 'span', 'yb-diary-page__postscript-label', line.kind));
          const value = element(doc, 'span');
          appendTokens(doc, value, line.tokens);
          row.append(value);
          postscript.append(row);
        });
        card.append(postscript);
      }
      return card;
    });
    content.replaceChildren(...cards);
  };

  const handleClick = async (event) => {
    const actionButton = event.target?.closest?.('[data-runtime-action]');
    if (!actionButton || disposed) return;
    const action = actionButton.dataset.runtimeAction;
    const handler = context.actions?.[action];
    if (typeof handler !== 'function') return;
    actionButton.disabled = true;
    try {
      const result = await handler();
      if (!disposed && status) status.textContent = actionMessage(action, result);
    } catch (error) {
      if (!disposed && status) status.textContent = text(error?.message) || `${ACTION_LABELS[action]}失败`;
    } finally {
      if (!disposed && !['previousTable', 'nextTable'].includes(action)) actionButton.disabled = false;
    }
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
