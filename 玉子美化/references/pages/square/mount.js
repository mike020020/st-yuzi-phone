const ACTION_LABELS = Object.freeze({ back: '返回', previousTable: '上一张', nextTable: '下一张', editCurrentTable: '编辑' });
const ID_HEADERS = Object.freeze(['帖子ID', '帖子唯一标识']);

function text(value) { return String(value ?? '').trim(); }
function splitList(value) { const source = text(value); return !source || source.toLowerCase() === 'none' ? [] : source.replace(/；/g, ';').split(';').map(text).filter(Boolean); }

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
function firstCell(row, names, fallback = '') { for (const name of names) { const value = text(cell(row, name)); if (value) return value; } return text(fallback); }

function parseComments(value) {
  return splitList(value).map((segment) => {
    const separator = segment.search(/[:：]/);
    return separator < 0
      ? { author: '网友', body: segment }
      : { author: text(segment.slice(0, separator)) || '网友', body: text(segment.slice(separator + 1)) || '（空评论）' };
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
  if (!root || typeof context.getState !== 'function' || typeof context.subscribe !== 'function') throw new Error('广场参考页需要 Runtime API v1 context');
  const doc = root.ownerDocument;
  const content = root.querySelector('[data-page-content]');
  const title = root.querySelector('[data-page-title]');
  const status = root.querySelector('[data-action-status]');
  const detail = root.querySelector('[data-square-detail]');
  const detailTitle = root.querySelector('[data-square-detail-title]');
  const detailBody = root.querySelector('[data-square-detail-body]');
  if (!doc || !content) throw new Error('广场入口缺少 data-page-content');
  let disposed = false;
  let mediaDetails = new Map();

  const closeDetail = () => { if (detail) detail.hidden = true; if (detailTitle) detailTitle.textContent = '媒体说明'; if (detailBody) detailBody.textContent = ''; };

  const render = (state = context.getState()) => {
    if (disposed) return;
    closeDetail();
    mediaDetails = new Map();
    if (title) title.textContent = state?.tableName || '广场';
    const previous = root.querySelector('[data-runtime-action="previousTable"]');
    const next = root.querySelector('[data-runtime-action="nextTable"]');
    if (previous) previous.disabled = !state?.canPrevious;
    if (next) next.disabled = !state?.canNext;
    const posts = rowsFromState(state).map((row, rowIndex) => {
      const id = firstCell(row, ID_HEADERS, `post_${rowIndex + 1}`);
      const normalizeDescription = (value) => { const result = text(value); return result.toLowerCase() === 'none' ? '' : result; };
      return {
        id,
        author: text(cell(row, '发帖账号名')) || '匿名',
        tag: text(cell(row, '账号标签')),
        title: text(cell(row, '帖子标题')),
        body: text(cell(row, '帖子正文')),
        topics: topicTokens(cell(row, '话题/附加信息')),
        image: normalizeDescription(cell(row, '图片描述')),
        video: normalizeDescription(cell(row, '视频描述')),
        interaction: text(cell(row, '互动数据')),
        time: text(cell(row, '时间文本')),
        comments: parseComments(cell(row, '评论串')),
      };
    }).reverse();
    if (posts.length === 0) { content.replaceChildren(element(doc, 'div', 'yb-square-page__empty', '暂无广场动态')); return; }
    const cards = posts.map((post, postIndex) => {
      const card = element(doc, 'article', 'yb-square-page__post');
      card.dataset.postId = post.id;
      const head = element(doc, 'header', 'yb-square-page__head');
      head.append(element(doc, 'span', 'yb-square-page__avatar', [...post.author][0] || '匿'));
      const authorBlock = element(doc, 'div', 'yb-square-page__author-block');
      const authorRow = element(doc, 'div', 'yb-square-page__author-row');
      authorRow.append(element(doc, 'span', 'yb-square-page__author', post.author));
      if (post.tag) authorRow.append(element(doc, 'span', 'yb-square-page__tag', post.tag));
      authorBlock.append(authorRow);
      if (post.time) authorBlock.append(element(doc, 'span', 'yb-square-page__time', post.time));
      head.append(authorBlock);
      card.append(head);
      if (post.title) card.append(element(doc, 'h2', 'yb-square-page__title', post.title));
      card.append(element(doc, 'p', 'yb-square-page__body', post.body || '（无正文）'));
      if (post.topics.length > 0 || post.image || post.video) {
        const topics = element(doc, 'div', 'yb-square-page__topics');
        post.topics.forEach(topic => topics.append(element(doc, 'span', 'yb-square-page__topic', `#${topic}`)));
        for (const [kind, label, description, icon] of [['image', '图片描述', post.image, '▧'], ['video', '视频描述', post.video, '▷']]) {
          if (!description) continue;
          const key = `${postIndex}:${kind}`;
          mediaDetails.set(key, { label, description });
          const media = element(doc, 'button', 'yb-square-page__media', icon);
          media.type = 'button';
          media.dataset.squareMedia = key;
          media.setAttribute('aria-label', `查看${label}`);
          topics.append(media);
        }
        card.append(topics);
      }
      const comments = element(doc, 'section', 'yb-square-page__comments');
      comments.append(element(doc, 'div', 'yb-square-page__section-title', '✤ 评论区'));
      if (post.comments.length === 0) comments.append(element(doc, 'div', 'yb-square-page__comment', '暂无评论'));
      else post.comments.forEach((comment) => { const line = element(doc, 'div', 'yb-square-page__comment'); line.append(element(doc, 'strong', '', `${comment.author}：`), element(doc, 'span', '', comment.body)); comments.append(line); });
      card.append(comments);
      if (post.interaction) {
        const footer = element(doc, 'footer', 'yb-square-page__footer');
        footer.append(element(doc, 'span', 'yb-square-page__action', '♡ 点赞'), element(doc, 'span', 'yb-square-page__action', '○ 评论'), element(doc, 'span', 'yb-square-page__interaction', post.interaction));
        card.append(footer);
      }
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
      try { const result = await handler(); if (!disposed && status) status.textContent = actionMessage(action, result); }
      catch (error) { if (!disposed && status) status.textContent = text(error?.message) || `${ACTION_LABELS[action]}失败`; }
      finally { if (!disposed && !['previousTable', 'nextTable'].includes(action)) actionButton.disabled = false; }
      return;
    }
    if (event.target?.closest?.('[data-square-detail-close]')) { closeDetail(); return; }
    const media = event.target?.closest?.('[data-square-media]');
    if (!media || disposed) return;
    const record = mediaDetails.get(text(media.dataset.squareMedia));
    if (!record || !detail) return;
    if (detailTitle) detailTitle.textContent = record.label;
    if (detailBody) detailBody.textContent = record.description;
    detail.hidden = false;
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
