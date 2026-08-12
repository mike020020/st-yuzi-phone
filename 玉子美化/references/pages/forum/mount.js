const ACTION_LABELS = Object.freeze({ back: '返回', previousTable: '上一张', nextTable: '下一张', editCurrentTable: '编辑' });
const COVER_TONES = Object.freeze(['mist', 'cream', 'sage', 'rose']);

function text(value) { return String(value ?? '').trim(); }
function splitList(value) {
  const source = text(value);
  return !source || source.toLowerCase() === 'none'
    ? []
    : source.replace(/；/g, ';').split(';').map(text).filter(Boolean);
}

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

function parseReplies(value) {
  return splitList(value).map((segment) => {
    const separator = segment.search(/[:：]/);
    return separator < 0
      ? { author: '网友', body: segment }
      : { author: text(segment.slice(0, separator)) || '网友', body: text(segment.slice(separator + 1)) || '（空回应）' };
  });
}

function topicTokens(value) {
  return text(value).replace(/#/g, ';').replace(/[，、|]/g, ';').split(/[;；]/).map(text).filter(Boolean);
}

function actionMessage(action, result) {
  if (result?.ok) return `${ACTION_LABELS[action]}请求已提交`;
  if (result?.status === 'unavailable') return `${ACTION_LABELS[action]}不可用`;
  if (result?.status === 'stale') return '页面已失效';
  return result?.message || `${ACTION_LABELS[action]}失败`;
}

export function mount(context) {
  const root = context?.root;
  if (!root || typeof context.getState !== 'function' || typeof context.subscribe !== 'function') throw new Error('论坛参考页需要 Runtime API v1 context');
  const doc = root.ownerDocument;
  const content = root.querySelector('[data-page-content]');
  const title = root.querySelector('[data-page-title]');
  const status = root.querySelector('[data-action-status]');
  if (!doc || !content) throw new Error('论坛入口缺少 data-page-content');
  let disposed = false;
  const collapsedThreads = new Set();

  const render = (state = context.getState()) => {
    if (disposed) return;
    if (title) title.textContent = state?.tableName || '论坛';
    const previous = root.querySelector('[data-runtime-action="previousTable"]');
    const next = root.querySelector('[data-runtime-action="nextTable"]');
    if (previous) previous.disabled = !state?.canPrevious;
    if (next) next.disabled = !state?.canNext;
    const threads = rowsFromState(state).map((row, rowIndex) => {
      const board = text(cell(row, '分区/版面名'));
      const author = text(cell(row, '发帖账号名')) || '匿名';
      const threadTitle = text(cell(row, '帖子标题')) || `帖子 ${rowIndex + 1}`;
      return {
        key: `${rowIndex}|${threadTitle}`,
        board,
        author,
        tag: text(cell(row, '账号标签')),
        title: threadTitle,
        body: text(cell(row, '帖子正文')),
        topics: topicTokens(cell(row, '附加信息')),
        interaction: text(cell(row, '热度/回应数据')),
        time: text(cell(row, '时间文本')),
        replies: parseReplies(cell(row, '评论串')),
        tone: COVER_TONES[hashIndex(threadTitle || board || author, COVER_TONES.length)],
      };
    }).reverse();
    if (threads.length === 0) {
      content.replaceChildren(element(doc, 'div', 'yb-forum-page__empty', '暂无论坛帖子'));
      return;
    }
    const cards = threads.map((thread) => {
      const collapsed = collapsedThreads.has(thread.key);
      const card = element(doc, 'article', 'yb-forum-page__thread');
      card.dataset.threadKey = thread.key;
      const cover = element(doc, 'div', `yb-forum-page__cover tone-${thread.tone}`);
      cover.setAttribute('aria-hidden', 'true');
      cover.append(element(doc, 'span', 'yb-forum-page__cover-mark', '✦'), element(doc, 'span', 'yb-forum-page__cover-board', thread.board || '主贴'));
      card.append(cover);
      const body = element(doc, 'div', 'yb-forum-page__thread-content');
      if (thread.board) body.append(element(doc, 'span', 'yb-forum-page__board', thread.board));
      body.append(element(doc, 'h2', 'yb-forum-page__title', thread.title), element(doc, 'p', 'yb-forum-page__body', thread.body || '（无正文）'));
      if (thread.topics.length > 0) {
        const topics = element(doc, 'div', 'yb-forum-page__topics');
        thread.topics.forEach(topic => topics.append(element(doc, 'span', 'yb-forum-page__topic', `#${topic}`)));
        body.append(topics);
      }
      const authorRow = element(doc, 'div', 'yb-forum-page__author-row');
      authorRow.append(element(doc, 'strong', 'yb-forum-page__author', thread.author));
      if (thread.tag) authorRow.append(element(doc, 'span', 'yb-forum-page__tag', thread.tag));
      if (thread.time) authorRow.append(element(doc, 'time', 'yb-forum-page__time', thread.time));
      body.append(authorRow);
      if (thread.interaction) body.append(element(doc, 'div', 'yb-forum-page__stats', thread.interaction));
      if (thread.replies.length > 0) {
        const replyHead = element(doc, 'div', 'yb-forum-page__reply-head');
        replyHead.append(element(doc, 'strong', '', `评论串 · ${thread.replies.length}`));
        const toggle = element(doc, 'button', 'yb-forum-page__reply-toggle', collapsed ? '展开' : '收起');
        toggle.type = 'button';
        toggle.dataset.forumReplies = thread.key;
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        replyHead.append(toggle);
        body.append(replyHead);
        const replies = element(doc, 'section', 'yb-forum-page__replies');
        replies.hidden = collapsed;
        replies.setAttribute('aria-label', `${thread.title}的评论`);
        thread.replies.forEach((reply, replyIndex) => {
          const item = element(doc, 'article', 'yb-forum-page__reply');
          item.append(element(doc, 'span', 'yb-forum-page__floor', `${replyIndex + 1}F`));
          const replyBody = element(doc, 'div');
          replyBody.append(element(doc, 'strong', 'yb-forum-page__reply-author', reply.author), element(doc, 'p', 'yb-forum-page__reply-body', reply.body));
          item.append(replyBody);
          replies.append(item);
        });
        body.append(replies);
      }
      card.append(body);
      return card;
    });
    content.replaceChildren(...cards);
  };

  const handleClick = async (event) => {
    const actionButton = event.target?.closest?.('[data-runtime-action]');
    if (actionButton) {
      const action = actionButton.dataset.runtimeAction;
      const handler = context.actions?.[action];
      if (disposed || typeof handler !== 'function') return;
      actionButton.disabled = true;
      try {
        const result = await handler();
        if (!disposed && status) status.textContent = actionMessage(action, result);
      } catch (error) {
        if (!disposed && status) status.textContent = text(error?.message) || `${ACTION_LABELS[action]}失败`;
      } finally {
        if (!disposed && !['previousTable', 'nextTable'].includes(action)) actionButton.disabled = false;
      }
      return;
    }
    const toggle = event.target?.closest?.('[data-forum-replies]');
    if (!toggle || disposed) return;
    const key = text(toggle.dataset.forumReplies);
    const card = toggle.closest?.('.yb-forum-page__thread');
    const replies = card?.querySelector?.('.yb-forum-page__replies');
    if (!key || !replies) return;
    const collapsed = !collapsedThreads.has(key);
    if (collapsed) collapsedThreads.add(key); else collapsedThreads.delete(key);
    replies.hidden = collapsed;
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.textContent = collapsed ? '展开' : '收起';
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
