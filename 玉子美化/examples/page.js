const ACTION_LABELS = Object.freeze({
  back: '返回',
  previousTable: '上一张',
  nextTable: '下一张',
  editCurrentTable: '编辑',
});

function actionMessage(action, result) {
  if (result?.ok) return `${ACTION_LABELS[action]}请求已提交`;
  if (result?.status === 'unavailable') return `${ACTION_LABELS[action]}不可用`;
  if (result?.status === 'stale') return '页面已失效';
  return result?.message || `${ACTION_LABELS[action]}失败`;
}

export function mount(context) {
  const root = context.root;
  const title = root.querySelector('#title');
  const rows = root.querySelector('#rows');
  const status = root.querySelector('#status');
  const previous = root.querySelector('#previous');
  const next = root.querySelector('#next');
  let disposed = false;

  const render = (state = context.getState()) => {
    if (disposed || !state) return;
    title.textContent = state.tableName;
    const header = state.headers.join(' / ');
    const body = state.rows.map(row => row.map(value => String(value ?? '')).join(' / '));
    rows.textContent = [header, ...body].filter(Boolean).join('\n');
    previous.disabled = !state.canPrevious;
    next.disabled = !state.canNext;
  };

  const handleClick = async (event) => {
    const button = event.target.closest?.('[data-action]');
    const action = button?.dataset?.action;
    if (disposed || !action || typeof context.actions[action] !== 'function') return;
    button.disabled = true;
    try {
      const result = await context.actions[action]();
      if (!disposed) status.textContent = actionMessage(action, result);
    } catch (error) {
      if (!disposed) status.textContent = error instanceof Error && error.message
        ? `${ACTION_LABELS[action]}失败：${error.message}`
        : `${ACTION_LABELS[action]}失败`;
    } finally {
      if (!disposed) {
        render();
        if (action !== 'previousTable' && action !== 'nextTable') button.disabled = false;
      }
    }
  };

  root.addEventListener('click', handleClick);
  const unsubscribe = context.subscribe(render);
  render();

  return () => {
    if (disposed) return;
    disposed = true;
    root.removeEventListener('click', handleClick);
    unsubscribe();
  };
}
