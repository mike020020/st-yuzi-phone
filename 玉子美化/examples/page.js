const context = window.__YUZI_BEAUTIFY_CURRENT_CONTEXT__;
const render = () => { context.container.querySelector('#rows').textContent = context.rows.map(row => row.join(' / ')).join('\n'); };
render();
context.updates.addEventListener('update', render);
