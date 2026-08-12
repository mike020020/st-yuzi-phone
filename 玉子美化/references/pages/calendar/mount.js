const ACTION_LABELS = Object.freeze({
  back: '返回',
  previousTable: '上一张',
  nextTable: '下一张',
  editCurrentTable: '编辑',
});
const WEEKDAYS = Object.freeze(['一', '二', '三', '四', '五', '六', '日']);
const RELATIONS = Object.freeze(['3天前', '前天', '昨天', '今天', '明天', '后天', '3天后']);
const FALLBACK_DATE = Object.freeze({ year: 2026, monthIndex: 0, day: 1, kind: 'real' });
const YEAR_RANGE = 50;

function text(value) { return String(value ?? '').trim(); }
function pad2(value) { return String(Math.trunc(Math.abs(Number(value))) || 0).padStart(2, '0'); }
function dateKey(year, monthIndex, day) { return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`; }

function hashIndex(value, modulo) {
  let hash = 0;
  for (const character of String(value ?? '')) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % modulo;
}

function parseChineseNumber(value) {
  const source = text(value);
  if (/^[+-]?\d+$/.test(source)) return Number(source);
  if (!/^[零〇一二两三四五六七八九十百千万]+$/.test(source)) return null;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let current = 0;
  let hasUnit = false;
  for (const character of source) {
    if (Object.hasOwn(digits, character)) { current = digits[character]; continue; }
    const unit = units[character];
    if (!unit) return null;
    hasUnit = true;
    if (unit === 10000) {
      section = (section + current) || 1;
      total += section * unit;
      section = 0;
    } else {
      section += (current || 1) * unit;
    }
    current = 0;
  }
  if (hasUnit) return total + section + current;
  return Number([...source].map(character => digits[character]).join(''));
}

function makeRealDate(year, month, day) {
  if (![year, month, day].every(Number.isSafeInteger) || month === 0 || day === 0) return null;
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  if (Number.isNaN(result.getTime())) return null;
  return {
    kind: 'real',
    year: result.getFullYear(),
    monthIndex: result.getMonth(),
    day: result.getDate(),
    key: dateKey(result.getFullYear(), result.getMonth(), result.getDate()),
  };
}

function parseDate(value, monthDaysValue) {
  const source = text(value);
  if (!source) return null;
  const real = source.match(/^([+-]?[0-9零〇一二两三四五六七八九十百千万]+)-([+-]?[0-9零〇一二两三四五六七八九十百千万]+)-([+-]?[0-9零〇一二两三四五六七八九十百千万]+)$/);
  if (real) {
    const parts = real.slice(1).map(parseChineseNumber);
    const parsed = makeRealDate(parts[0], parts[1], parts[2]);
    if (parsed) return { ...parsed, label: source };
  }
  const abstract = source.match(/^(.+?)-(.+?)-([0-9零〇一二两三四五六七八九十百千万]+)$/);
  if (!abstract) return null;
  const day = parseChineseNumber(abstract[3]);
  if (!Number.isSafeInteger(day) || day === 0) return null;
  const monthDaysNumber = Number(monthDaysValue);
  const monthDays = Number.isInteger(monthDaysNumber) && monthDaysNumber >= 28 && monthDaysNumber <= 31 ? monthDaysNumber : 30;
  const year = 2026 + hashIndex(abstract[1], 7);
  const monthIndex = hashIndex(abstract[2], 12);
  return { kind: 'abstract', year, monthIndex, day, monthDays, key: dateKey(year, monthIndex, day), label: source };
}

function offsetDate(anchor, offset) {
  if (anchor?.kind === 'abstract') {
    const monthDays = anchor.monthDays || 30;
    const total = anchor.monthIndex * monthDays + anchor.day - 1 + offset;
    const cycle = monthDays * 12;
    const yearOffset = Math.floor(total / cycle);
    const normalized = ((total % cycle) + cycle) % cycle;
    const monthIndex = Math.floor(normalized / monthDays);
    const day = normalized % monthDays + 1;
    const year = anchor.year + yearOffset;
    return { kind: 'abstract', year, monthIndex, day, monthDays, key: dateKey(year, monthIndex, day) };
  }
  const base = makeRealDate(anchor?.year, Number(anchor?.monthIndex) + 1, anchor?.day);
  if (!base) return null;
  const shifted = makeRealDate(base.year, base.monthIndex + 1, base.day + offset);
  return shifted;
}

function element(doc, tag, className = '', value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function button(doc, className, label, data = {}) {
  const node = element(doc, 'button', className, label);
  node.type = 'button';
  Object.assign(node.dataset, data);
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

function buildModel(state) {
  const entries = rowsFromState(state).map((row) => {
    const rawDate = text(cell(row, '日期'));
    const monthDays = text(cell(row, '月份几天'));
    return {
      rawDate,
      parsedDate: parseDate(rawDate, monthDays),
      weekday: text(cell(row, '星期几')),
      festival: text(cell(row, '节日')),
      event: text(cell(row, '大事件')),
      status: text(cell(row, '状态')),
      weather: text(cell(row, '天气')),
      relation: text(cell(row, '与今天的关系')),
      description: text(cell(row, '内容')),
    };
  }).filter(entry => entry.rawDate || entry.event || entry.description);
  const anchor = entries.find(entry => entry.relation === '今天' && entry.parsedDate)
    || entries.find(entry => entry.parsedDate)
    || null;
  const anchorDate = anchor?.parsedDate || FALLBACK_DATE;
  const byDate = new Map();
  entries.forEach((entry) => {
    const relationIndex = RELATIONS.indexOf(entry.relation);
    const resolved = anchor?.parsedDate && relationIndex >= 0 ? offsetDate(anchor.parsedDate, relationIndex - 3) : entry.parsedDate;
    if (!resolved?.key) return;
    byDate.set(resolved.key, { ...entry, key: resolved.key, displayDate: entry.rawDate || resolved.key });
  });
  const selectedKey = anchor?.parsedDate?.key || byDate.keys().next().value || dateKey(anchorDate.year, anchorDate.monthIndex, anchorDate.day);
  return { entries, anchorDate, byDate, selectedKey, todayKey: anchor?.parsedDate?.key || selectedKey };
}

function monthGrid(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const mondayIndex = (first.getDay() + 6) % 7;
  const result = [];
  for (let index = mondayIndex; index > 0; index -= 1) {
    const day = new Date(year, monthIndex, 1 - index);
    result.push({ year: day.getFullYear(), monthIndex: day.getMonth(), day: day.getDate(), current: false });
  }
  for (let day = 1; day <= last.getDate(); day += 1) result.push({ year, monthIndex, day, current: true });
  while (result.length % 7 !== 0) {
    const day = new Date(year, monthIndex + 1, result.length - mondayIndex - last.getDate() + 1);
    result.push({ year: day.getFullYear(), monthIndex: day.getMonth(), day: day.getDate(), current: false });
  }
  return result.map(day => ({ ...day, key: dateKey(day.year, day.monthIndex, day.day) }));
}

function actionMessage(action, result) {
  if (result?.ok) return `${ACTION_LABELS[action]}请求已提交`;
  if (result?.status === 'unavailable') return `${ACTION_LABELS[action]}不可用`;
  if (result?.status === 'stale') return '页面已失效';
  return result?.message || `${ACTION_LABELS[action]}失败`;
}

export function mount(context) {
  const root = context?.root;
  if (!root || typeof context.getState !== 'function' || typeof context.subscribe !== 'function') throw new Error('小日历需要 Runtime API v1 context');
  const doc = root.ownerDocument;
  const content = root.querySelector('[data-page-content]');
  const title = root.querySelector('[data-page-title]');
  const status = root.querySelector('[data-action-status]');
  if (!doc || !content) throw new Error('小日历入口缺少 data-page-content');
  let disposed = false;
  let model = null;
  let viewYear = FALLBACK_DATE.year;
  let viewMonth = FALLBACK_DATE.monthIndex;
  let selectedKey = '';
  let pickerOpen = false;

  const renderView = () => {
    if (disposed || !model) return;
    if (model.entries.length === 0) {
      content.replaceChildren(element(doc, 'div', 'yb-calendar-page__empty', '暂无小日历内容'));
      return;
    }
    const view = element(doc, 'div', 'yb-calendar-page__view');
    const header = element(doc, 'section', 'yb-calendar-page__header');
    header.append(button(doc, 'yb-calendar-page__month-button', '‹', { calendarAction: 'previous-month' }));
    const monthSelect = element(doc, 'div', 'yb-calendar-page__month-select');
    monthSelect.append(element(doc, 'div', 'yb-calendar-page__month-label', `${viewYear}年${viewMonth + 1}月`));
    const picker = element(doc, 'div', 'yb-calendar-page__year-picker');
    const toggle = button(doc, 'yb-calendar-page__year-toggle', `${viewYear} ⌄`, { calendarAction: 'toggle-year' });
    toggle.setAttribute('aria-expanded', pickerOpen ? 'true' : 'false');
    picker.append(toggle);
    const panel = element(doc, 'div', 'yb-calendar-page__year-panel');
    panel.hidden = !pickerOpen;
    panel.setAttribute('role', 'listbox');
    for (let year = viewYear - YEAR_RANGE; year <= viewYear + YEAR_RANGE; year += 1) {
      const option = button(doc, `yb-calendar-page__year-option${year === viewYear ? ' is-selected' : ''}`, year, { calendarAction: 'select-year', calendarYear: String(year) });
      option.setAttribute('aria-selected', year === viewYear ? 'true' : 'false');
      panel.append(option);
    }
    picker.append(panel);
    monthSelect.append(picker);
    header.append(monthSelect, button(doc, 'yb-calendar-page__month-button', '›', { calendarAction: 'next-month' }));
    view.append(header);
    const weekdays = element(doc, 'section', 'yb-calendar-page__weekdays');
    WEEKDAYS.forEach(label => weekdays.append(element(doc, 'span', '', label)));
    view.append(weekdays);
    const grid = element(doc, 'section', 'yb-calendar-page__grid');
    monthGrid(viewYear, viewMonth).forEach((day) => {
      const classes = ['yb-calendar-page__day'];
      if (!day.current) classes.push('is-outside');
      if (day.key === model.todayKey) classes.push('is-today');
      if (day.key === selectedKey) classes.push('is-selected');
      const dayButton = button(doc, classes.join(' '), day.day, { calendarDate: day.key });
      dayButton.setAttribute('aria-label', day.key);
      if (model.byDate.has(day.key)) dayButton.append(element(doc, 'span', 'yb-calendar-page__dot'));
      grid.append(dayButton);
    });
    view.append(grid);
    const entry = model.byDate.get(selectedKey);
    if (!entry) {
      view.append(element(doc, 'section', 'yb-calendar-page__empty', '暂无日程内容'));
    } else {
      const detail = element(doc, 'section', 'yb-calendar-page__detail');
      const detailHead = element(doc, 'div', 'yb-calendar-page__detail-head');
      const dateBlock = element(doc, 'div');
      dateBlock.append(element(doc, 'div', 'yb-calendar-page__detail-date', entry.displayDate));
      dateBlock.append(element(doc, 'div', 'yb-calendar-page__detail-relation', entry.relation));
      detailHead.append(dateBlock);
      const badges = element(doc, 'div', 'yb-calendar-page__badges');
      if (entry.status) badges.append(element(doc, 'span', 'yb-calendar-page__badge', entry.status));
      if (entry.weather) badges.append(element(doc, 'span', 'yb-calendar-page__badge is-weather', entry.weather));
      detailHead.append(badges);
      detail.append(detailHead);
      if (entry.festival) detail.append(element(doc, 'div', 'yb-calendar-page__festival', entry.festival));
      if (entry.event) detail.append(element(doc, 'div', 'yb-calendar-page__event', entry.event));
      if (entry.description) detail.append(element(doc, 'p', 'yb-calendar-page__description', entry.description));
      view.append(detail);
    }
    content.replaceChildren(view);
  };

  const render = (state = context.getState()) => {
    if (disposed) return;
    model = buildModel(state);
    viewYear = model.anchorDate.year;
    viewMonth = model.anchorDate.monthIndex;
    selectedKey = model.selectedKey;
    pickerOpen = false;
    if (title) title.textContent = state?.tableName || '小日历';
    const previous = root.querySelector('[data-runtime-action="previousTable"]');
    const next = root.querySelector('[data-runtime-action="nextTable"]');
    if (previous) previous.disabled = !state?.canPrevious;
    if (next) next.disabled = !state?.canNext;
    renderView();
  };

  const handleClick = async (event) => {
    const runtimeButton = event.target?.closest?.('[data-runtime-action]');
    if (runtimeButton) {
      const action = runtimeButton.dataset.runtimeAction;
      const handler = context.actions?.[action];
      if (disposed || typeof handler !== 'function') return;
      runtimeButton.disabled = true;
      try {
        const result = await handler();
        if (!disposed && status) status.textContent = actionMessage(action, result);
      } catch (error) {
        if (!disposed && status) status.textContent = text(error?.message) || `${ACTION_LABELS[action]}失败`;
      } finally {
        if (!disposed && !['previousTable', 'nextTable'].includes(action)) runtimeButton.disabled = false;
      }
      return;
    }
    const target = event.target?.closest?.('[data-calendar-action], [data-calendar-date]');
    if (!target || disposed || !model) return;
    const action = target.dataset.calendarAction;
    if (action === 'toggle-year') pickerOpen = !pickerOpen;
    if (action === 'select-year') { const year = Number(target.dataset.calendarYear); if (Number.isFinite(year)) viewYear = Math.trunc(year); pickerOpen = false; }
    if (action === 'previous-month' || action === 'next-month') {
      const offset = action === 'previous-month' ? -1 : 1;
      const date = new Date(viewYear, viewMonth + offset, 1);
      viewYear = date.getFullYear();
      viewMonth = date.getMonth();
      pickerOpen = false;
    }
    if (target.dataset.calendarDate) { selectedKey = text(target.dataset.calendarDate); pickerOpen = false; }
    renderView();
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
