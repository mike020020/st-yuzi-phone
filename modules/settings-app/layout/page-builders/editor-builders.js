import { escapeHtml, escapeHtmlAttr } from '../../../utils/dom-escape.js';
import {
    buildSettingsHeroHtml,
    buildSettingsPageFrame,
    buildSettingsSectionHtml,
} from '../primitives.js';

export function buildBeautifyTemplatePageHtml(viewModel = {}) {
    const presets = Array.isArray(viewModel.presets) ? viewModel.presets : [];
    const tables = Array.isArray(viewModel.tables) ? viewModel.tables : [];
    const status = String(viewModel.status || 'loading');
    const heroHtml = buildSettingsHeroHtml({
        eyebrow: '模板工坊',
        title: '模板工坊',
        description: '导入完整预设，并按当前真实表选择小剧场或通用表的展示模板。',
    });
    const statusHtml = status === 'loading'
        ? '<div class="phone-settings-note">正在读取模板仓库…</div>'
        : status === 'unavailable' || status === 'error'
            ? `<div class="phone-settings-note">模板仓库不可用：${escapeHtml(viewModel.error?.message || '未知错误')}</div>`
            : '';
    const presetCardsHtml = presets.length > 0
        ? presets.map((preset) => {
            const issues = Array.isArray(preset.issues) ? preset.issues : [];
            return `<article class="phone-settings-card">
                <div class="phone-settings-card-title">${escapeHtml(preset.name || preset.id)}</div>
                <div class="phone-settings-card-desc">ID：${escapeHtml(preset.id)} · ${Number(preset.items?.length || 0)} 个单表项</div>
                ${issues.length > 0 ? `<ul class="phone-settings-list">${issues.map((issue) => `<li><strong>${escapeHtml(issue.code || 'issue')}</strong>：${escapeHtml(issue.message || '')}</li>`).join('')}</ul>` : ''}
                <div class="phone-settings-action"><button type="button" class="phone-settings-btn" data-action="export" data-preset-id="${escapeHtmlAttr(preset.id)}">导出</button><button type="button" class="phone-settings-btn phone-settings-btn-danger" data-action="delete" data-preset-id="${escapeHtmlAttr(preset.id)}">删除</button></div>
            </article>`;
        }).join('')
        : '<div class="phone-settings-note">尚未导入玉子美化预设。</div>';
    const tableCardsHtml = tables.length > 0
        ? tables.map((table) => {
            const candidates = Array.isArray(table.candidates) ? table.candidates : [];
            const active = table.active;
            const candidatesHtml = candidates.length > 0
                ? candidates.map((candidate) => {
                    const selected = active?.presetId === candidate.presetId && active?.itemId === candidate.itemId;
                    return `<div class="phone-settings-row"><div class="phone-settings-row-main"><div class="phone-settings-row-title">${escapeHtml(candidate.preset?.name || candidate.presetId)} / ${escapeHtml(candidate.item?.name || candidate.itemId)}</div><div class="phone-settings-row-desc">${selected ? '当前已启用' : '表名与声明字段精确匹配'}</div></div><button type="button" class="phone-settings-btn" data-action="activate" data-sheet-key="${escapeHtmlAttr(table.sheetKey)}" data-preset-id="${escapeHtmlAttr(candidate.presetId)}" data-item-id="${escapeHtmlAttr(candidate.itemId)}" ${selected ? 'disabled' : ''}>${selected ? '当前' : '设为当前'}</button></div>`;
                }).join('')
                : '<div class="phone-settings-note">没有匹配此表名与字段的可运行预设项。</div>';
            return `<article class="phone-settings-card"><div class="phone-settings-card-title">${escapeHtml(table.tableName || table.sheetKey)}</div><div class="phone-settings-card-desc">sheetKey：${escapeHtml(table.sheetKey)} · 字段：${escapeHtml((table.headers || []).join('、') || '无')}</div>${candidatesHtml}<div class="phone-settings-action"><button type="button" class="phone-settings-btn" data-action="clear" data-sheet-key="${escapeHtmlAttr(table.sheetKey)}" ${active ? '' : 'disabled'}>恢复默认</button></div></article>`;
        }).join('')
        : '<div class="phone-settings-note">没有可配置的真实表。</div>';
    const bodyHtml = `${statusHtml}
        ${buildSettingsSectionHtml({ title: '完整预设', desc: '同 ID 导入会要求确认；覆盖后清除该预设的全部表绑定。', bodyHtml: `<div class="phone-settings-action"><button type="button" class="phone-settings-btn phone-settings-btn-primary" data-action="import">导入预设</button></div>${presetCardsHtml}` })}
        ${buildSettingsSectionHtml({ title: '真实表绑定', desc: '列出当前真实表并允许切换它们的展示模板。', bodyHtml: `${tableCardsHtml}<div class="phone-settings-action"><button type="button" class="phone-settings-btn phone-settings-btn-danger" data-action="clear-all">全部恢复默认</button></div>` })}`;
    return buildSettingsPageFrame({
        title: '模板工坊',
        heroHtml,
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml,
    });
}
