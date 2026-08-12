import { escapeHtml, escapeHtmlAttr } from '../../utils/dom-escape.js';
import { QQ_V2_PROMPT_PLACEHOLDER_DEFINITIONS } from '../../qq-v2/prompt/placeholders.js';
import { buildSettingsPageFrame, buildSettingsSectionHtml } from '../layout/primitives.js';
import { downloadTextFile } from '../services/media-upload/download.js';
import { showAlertDialog, showConfirmDialog } from '../ui/confirm-dialog.js';
import {
    AI_INSTRUCTION_PROMPT_ROLES,
    createAiInstructionDraft,
    createNewAiInstructionDraft,
    findMisreadControlMessages,
    removeMisreadControlMessages,
} from './ai-instruction-preset-draft.js';

function asText(value) {
    return String(value || '').trim();
}

function getErrorMessage(result, fallback) {
    return asText(result?.error?.message) || fallback;
}

function filenamePart(value) {
    return asText(value).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 80) || 'preset';
}

function buildPresetOptions(presets, selectedPresetId) {
    const selectedId = asText(selectedPresetId);
    return [
        selectedId ? '' : '<option value="" selected>新建 AI 指令预设（未保存）</option>',
        ...(Array.isArray(presets) ? presets : []).map((preset) => {
            const presetId = asText(preset?.presetId);
            const suffix = preset?.isBuiltIn === true ? '（内置）' : '';
            return `<option value="${escapeHtmlAttr(presetId)}" ${presetId === selectedId ? 'selected' : ''}>${escapeHtml(`${preset?.name || '未命名预设'}${suffix}`)}</option>`;
        }),
    ].join('');
}

function buildRoleOptions(role) {
    return AI_INSTRUCTION_PROMPT_ROLES.map(value => (
        `<option value="${value}" ${value === role ? 'selected' : ''}>${value}</option>`
    )).join('');
}

function buildPlaceholderGuide() {
    const items = QQ_V2_PROMPT_PLACEHOLDER_DEFINITIONS.map(({ token, description }) => `
        <li><code>${escapeHtml(token)}</code><span>${escapeHtml(description)}</span></li>
    `).join('');
    return buildSettingsSectionHtml({
        title: '占位符说明',
        desc: '把占位符写入任意消息块内容，发起请求时会替换为对应资料。',
        bodyHtml: `<ul class="phone-ai-preset-placeholder-list">${items}</ul>`,
    });
}

function buildMessageBlocks(messages, disabled) {
    if (messages.length === 0) return '<div class="phone-empty-msg">当前预设没有消息块。</div>';
    return messages.map((message, index) => `
        <article class="phone-ai-preset-segment-card" data-message-index="${index}">
            <div class="phone-ai-preset-segment-toolbar">
                <span class="phone-ai-preset-segment-index">#${index + 1}</span>
                <div class="phone-ai-preset-segment-toolbar-actions">
                    <button type="button" class="phone-settings-btn phone-ai-message-up-btn" data-message-index="${index}" ${index === 0 || disabled ? 'disabled' : ''}>上移</button>
                    <button type="button" class="phone-settings-btn phone-ai-message-down-btn" data-message-index="${index}" ${index === messages.length - 1 || disabled ? 'disabled' : ''}>下移</button>
                    <button type="button" class="phone-settings-btn phone-settings-btn-danger phone-ai-message-delete-btn" data-message-index="${index}" ${disabled}>删除</button>
                </div>
            </div>
            <label class="phone-ai-preset-segment-field">
                <span>消息块名称</span>
                <input class="phone-settings-input phone-ai-preset-segment-name-input phone-ai-message-name" maxlength="120" value="${escapeHtmlAttr(message.name)}" ${disabled}>
            </label>
            <label class="phone-ai-preset-segment-field">
                <span>角色</span>
                <select class="phone-settings-select phone-ai-message-role" ${disabled}>${buildRoleOptions(message.role)}</select>
            </label>
            <label class="phone-ai-preset-segment-field">
                <span>内容</span>
                <textarea class="phone-settings-textarea phone-ai-message-content" rows="8" ${disabled}>${escapeHtml(message.content)}</textarea>
            </label>
        </article>
    `).join('');
}

function buildAiInstructionPresetsPageHtml(pageState) {
    const draft = pageState.draft || createNewAiInstructionDraft();
    const disabled = pageState.loading || pageState.busy ? 'disabled' : '';
    const canDelete = draft.presetId && !draft.isBuiltIn && !disabled;
    const canRestoreCurrent = draft.presetId && draft.isBuiltIn && !disabled;
    const suspiciousEmptyCount = findMisreadControlMessages(draft.messages).indexes.length;
    const status = pageState.error
        ? `<div class="phone-settings-inline-status is-danger"><span class="phone-settings-inline-status-text">${escapeHtml(pageState.error)}</span></div>`
        : pageState.loading
            ? '<div class="phone-settings-note">正在读取 AI 指令预设...</div>'
            : '';
    const managementSection = buildSettingsSectionHtml({
        title: 'AI 指令预设',
        extraClass: 'phone-ai-instruction-presets-section',
        bodyHtml: `
            ${status}
            <div class="phone-settings-action phone-settings-action-wrap phone-ai-preset-management-actions">
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-import-btn" ${disabled}>导入</button>
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-export-current-btn" ${draft.presetId && !disabled ? '' : 'disabled'}>导出当前</button>
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-export-all-btn" ${pageState.presets.length && !disabled ? '' : 'disabled'}>导出全部</button>
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-restore-current-btn" ${canRestoreCurrent ? '' : 'disabled'}>恢复当前</button>
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-restore-all-btn" ${disabled}>恢复全部</button>
                <input type="file" id="phone-ai-instruction-import-file" accept="application/json,.json" hidden ${disabled}>
            </div>
            <label class="phone-ai-preset-segment-field">
                <span>选择预设</span>
                <select id="phone-ai-instruction-preset-select" class="phone-settings-select" ${disabled}>${buildPresetOptions(pageState.presets, pageState.selectedPresetId)}</select>
            </label>
            <div class="phone-settings-action-row">
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-new-btn" ${disabled}>新建 AI 指令预设</button>
            </div>
            <label class="phone-ai-preset-segment-field">
                <span>预设名称</span>
                <input id="phone-ai-instruction-preset-name" class="phone-settings-input" maxlength="120" value="${escapeHtmlAttr(draft.name)}" ${disabled}>
            </label>
        `,
    });
    const messagesSection = buildSettingsSectionHtml({
        title: '消息块',
        actionsHtml: `<button type="button" class="phone-settings-btn" id="phone-ai-instruction-add-message-btn" ${disabled}>添加消息块</button>`,
        bodyHtml: `
            <div class="phone-settings-action-row phone-ai-preset-save-actions">
                <button type="button" class="phone-settings-btn phone-settings-btn-primary" id="phone-ai-instruction-save-btn" ${disabled}>保存预设</button>
                <button type="button" class="phone-settings-btn" id="phone-ai-instruction-save-as-btn" ${disabled}>另存为</button>
                <button type="button" class="phone-settings-btn phone-settings-btn-danger" id="phone-ai-instruction-delete-btn" ${canDelete ? '' : 'disabled'}>删除预设</button>
                ${suspiciousEmptyCount >= 3 ? `<button type="button" class="phone-settings-btn" id="phone-ai-instruction-cleanup-btn" ${disabled}>清理疑似异常空块（${suspiciousEmptyCount}）</button>` : ''}
            </div>
            <div id="phone-ai-instruction-message-stack" class="phone-ai-preset-segment-stack">${buildMessageBlocks(draft.messages, disabled)}</div>
        `,
    });
    return buildSettingsPageFrame({
        title: 'AI 指令预设',
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml: `${managementSection}${messagesSection}${buildPlaceholderGuide()}`,
    });
}

function createAiInstructionPresetSession(ctx) {
    const state = {
        loading: true,
        busy: false,
        error: '',
        presets: [],
        selectedPresetId: '',
        draft: createNewAiInstructionDraft(),
    };
    let active = false;
    let generation = 0;
    const isCurrent = token => active && token === generation;
    const repaint = () => {
        if (!active) return;
        if (typeof ctx.rerenderAiInstructionPresetsKeepScroll === 'function') {
            ctx.rerenderAiInstructionPresetsKeepScroll();
            return;
        }
        ctx.render?.();
    };
    const notify = (message, isError = false) => ctx.showToast?.(ctx.container, message, isError, ctx.pageRuntime);
    const findPreset = id => state.presets.find(preset => asText(preset?.presetId) === asText(id)) || null;
    const hasNameConflict = (name, ignoredPresetId = '') => state.presets.some((preset) => (
        asText(preset?.presetId) !== asText(ignoredPresetId)
        && asText(preset?.name) === asText(name)
    ));
    const showNameConflict = () => showAlertDialog(
        ctx.container,
        '预设名称重复',
        '已经存在同名 AI 指令预设，请修改名称后再保存。',
        '知道了',
        ctx.pageRuntime,
    );

    const load = async (selectedPresetId = state.selectedPresetId, repaintLoading = true) => {
        const token = ++generation;
        state.loading = true;
        state.error = '';
        if (repaintLoading) repaint();
        const result = await ctx.qqV2PresetService.readSharedResources();
        if (!isCurrent(token)) return false;
        state.loading = false;
        if (result?.ok !== true) {
            state.error = getErrorMessage(result, '读取 AI 指令预设失败');
            repaint();
            return false;
        }
        state.presets = Array.isArray(result.promptPresets) ? result.promptPresets : [];
        const selected = findPreset(selectedPresetId) || findPreset(state.selectedPresetId) || state.presets[0] || null;
        state.selectedPresetId = asText(selected?.presetId);
        state.draft = selected ? createAiInstructionDraft(selected) : createNewAiInstructionDraft();
        repaint();
        return true;
    };

    const select = (presetId) => {
        if (state.busy) return;
        const selected = findPreset(presetId);
        state.selectedPresetId = asText(selected?.presetId);
        state.draft = selected ? createAiInstructionDraft(selected) : createNewAiInstructionDraft();
        repaint();
    };

    const save = async (draft, saveAs = false) => {
        if (!active || state.busy) return false;
        const nextDraft = createAiInstructionDraft({ ...state.draft, ...draft });
        const ignoredPresetId = saveAs ? '' : nextDraft.presetId;
        if (hasNameConflict(nextDraft.name, ignoredPresetId)) {
            showNameConflict();
            return false;
        }
        state.busy = true;
        state.draft = nextDraft;
        repaint();
        const preset = {
            ...(!saveAs && state.draft.presetId ? { id: state.draft.presetId } : {}),
            name: state.draft.name,
            messages: state.draft.messages,
        };
        const result = await ctx.qqV2PresetService.savePromptPreset({ preset });
        if (!active) return false;
        state.busy = false;
        if (result?.ok !== true) {
            if (result?.error?.code === 'prompt_preset_name_conflict') {
                repaint();
                showNameConflict();
                return false;
            }
            notify(getErrorMessage(result, '保存 AI 指令预设失败'), true);
            repaint();
            return false;
        }
        notify(saveAs ? 'AI 指令预设已另存为新预设' : 'AI 指令预设已保存');
        return load(result.promptPreset?.presetId, false);
    };

    const remove = async () => {
        if (!active || state.busy || !state.draft.presetId || state.draft.isBuiltIn) return false;
        state.busy = true;
        repaint();
        const result = await ctx.qqV2PresetService.deletePromptPreset({ promptPresetId: state.draft.presetId });
        if (!active) return false;
        state.busy = false;
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '删除 AI 指令预设失败'), true);
            repaint();
            return false;
        }
        notify('AI 指令预设已删除');
        return load('', false);
    };

    const restoreCurrent = async () => {
        if (!active || state.busy || !state.draft.presetId || !state.draft.isBuiltIn) return false;
        state.busy = true;
        repaint();
        const result = await ctx.qqV2PresetService.restoreBuiltInPromptPreset({ promptPresetId: state.draft.presetId });
        if (!active) return false;
        state.busy = false;
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '恢复内置预设失败'), true);
            repaint();
            return false;
        }
        notify('内置预设已恢复');
        return load(result.promptPreset?.presetId, false);
    };

    const restoreAll = async () => {
        if (!active || state.busy) return false;
        state.busy = true;
        repaint();
        const result = await ctx.qqV2PresetService.restoreAllBuiltInPromptPresets();
        if (!active) return false;
        state.busy = false;
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '恢复全部内置预设失败'), true);
            repaint();
            return false;
        }
        notify('四份内置预设已恢复');
        return load(state.selectedPresetId, false);
    };

    const importFile = async (file) => {
        if (!active || state.busy || !file || typeof file.text !== 'function') return false;
        state.busy = true;
        repaint();
        let source;
        try {
            source = JSON.parse(await file.text());
        } catch {
            state.busy = false;
            notify('导入文件不是有效的 JSON', true);
            repaint();
            return false;
        }
        const result = await ctx.qqV2PresetService.importPromptPresets({ source });
        if (!active) return false;
        state.busy = false;
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '导入 AI 指令预设失败'), true);
            repaint();
            return false;
        }
        const firstId = result.promptPresets?.[0]?.presetId || '';
        notify('AI 指令预设已导入');
        return load(firstId, false);
    };

    const exportCurrent = async () => {
        if (!active || state.busy || !state.draft.presetId) return false;
        const result = await ctx.qqV2PresetService.exportPromptPreset({ promptPresetId: state.draft.presetId });
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '导出当前预设失败'), true);
            return false;
        }
        downloadTextFile(`qq-v2-ai-${filenamePart(result.promptPreset?.name)}.json`, JSON.stringify({ presets: [result.promptPreset] }, null, 2), 'application/json');
        notify('当前 AI 指令预设已导出');
        return true;
    };

    const exportAll = async () => {
        if (!active || state.busy) return false;
        const result = await ctx.qqV2PresetService.exportAllPromptPresets();
        if (result?.ok !== true) {
            notify(getErrorMessage(result, '导出全部预设失败'), true);
            return false;
        }
        downloadTextFile('qq-v2-ai-presets.json', JSON.stringify({ presets: result.promptPresets }, null, 2), 'application/json');
        notify('全部 AI 指令预设已导出');
        return true;
    };

    return {
        state,
        activate() { active = true; },
        deactivate() { active = false; generation += 1; },
        load,
        select,
        newPreset() {
            if (state.busy) return;
            state.selectedPresetId = '';
            state.draft = createNewAiInstructionDraft();
            repaint();
        },
        save,
        saveAs(draft) { return save(draft, true); },
        remove,
        restoreCurrent,
        restoreAll,
        importFile,
        exportCurrent,
        exportAll,
        addMessage(draft) {
            state.draft = createAiInstructionDraft({ ...state.draft, ...draft, messages: [...draft.messages, { id: '', name: '新消息块', role: 'system', content: '' }] });
            repaint();
        },
        moveMessage(draft, fromIndex, toIndex) {
            const messages = [...draft.messages];
            if (fromIndex < 0 || toIndex < 0 || fromIndex >= messages.length || toIndex >= messages.length) return;
            const [message] = messages.splice(fromIndex, 1);
            messages.splice(toIndex, 0, message);
            state.draft = createAiInstructionDraft({ ...state.draft, ...draft, messages });
            repaint();
        },
        deleteMessage(draft, index) {
            state.draft = createAiInstructionDraft({ ...state.draft, ...draft, messages: draft.messages.filter((_, messageIndex) => messageIndex !== index) });
            repaint();
        },
        cleanupMessages(draft) {
            const result = removeMisreadControlMessages(draft.messages);
            state.draft = createAiInstructionDraft({ ...state.draft, ...draft, messages: result.messages });
            repaint();
            return result.removedCount;
        },
    };
}

function bindAiInstructionPresetInteractions(ctx, session) {
    const { container, state, render, pageRuntime } = ctx;
    const addListener = (target, type, listener) => pageRuntime?.addEventListener?.(target, type, listener);
    const readDraft = () => ({
        ...session.state.draft,
        name: asText(container.querySelector('#phone-ai-instruction-preset-name')?.value),
        messages: Array.from(container.querySelectorAll('.phone-ai-preset-segment-card')).map((block, index) => ({
            id: session.state.draft.messages[index]?.id || '',
            name: asText(block.querySelector('.phone-ai-message-name')?.value) || '未命名消息块',
            role: String(block.querySelector('.phone-ai-message-role')?.value || 'system'),
            content: String(block.querySelector('.phone-ai-message-content')?.value || ''),
        })),
    });

    addListener(container.querySelector('.phone-nav-back'), 'click', () => { state.mode = 'home'; render(); });
    addListener(container.querySelector('#phone-ai-instruction-preset-select'), 'change', (event) => session.select(event.currentTarget?.value));
    addListener(container.querySelector('#phone-ai-instruction-new-btn'), 'click', () => session.newPreset());
    addListener(container.querySelector('#phone-ai-instruction-save-btn'), 'click', () => { void session.save(readDraft()); });
    addListener(container.querySelector('#phone-ai-instruction-save-as-btn'), 'click', () => { void session.saveAs(readDraft()); });
    addListener(container.querySelector('#phone-ai-instruction-add-message-btn'), 'click', () => session.addMessage(readDraft()));
    addListener(container.querySelector('#phone-ai-instruction-restore-current-btn'), 'click', () => { void session.restoreCurrent(); });
    addListener(container.querySelector('#phone-ai-instruction-restore-all-btn'), 'click', () => {
        showConfirmDialog(container, '恢复全部内置预设', '将恢复四份内置预设，自定义预设不会删除。', () => { void session.restoreAll(); }, '恢复', '取消', pageRuntime);
    });
    addListener(container.querySelector('#phone-ai-instruction-delete-btn'), 'click', () => {
        const draft = readDraft();
        const name = asText(draft.name) || '当前 AI 指令预设';
        showConfirmDialog(container, '删除 AI 指令预设', `确定删除「${name}」吗？`, () => { void session.remove(); }, '删除', '取消', pageRuntime);
    });
    addListener(container.querySelector('#phone-ai-instruction-cleanup-btn'), 'click', () => {
        const draft = readDraft();
        const count = findMisreadControlMessages(draft.messages).indexes.length;
        showConfirmDialog(
            container,
            '清理疑似异常空块',
            `将从当前草稿移除 ${count} 个“未命名 / system / 空内容”消息块。清理后请检查并手动保存。`,
            () => { session.cleanupMessages(draft); },
            '清理',
            '取消',
            pageRuntime,
        );
    });
    const importInput = container.querySelector('#phone-ai-instruction-import-file');
    addListener(container.querySelector('#phone-ai-instruction-import-btn'), 'click', () => importInput?.click());
    addListener(importInput, 'change', () => {
        const file = importInput?.files?.[0];
        if (importInput) importInput.value = '';
        if (file) void session.importFile(file);
    });
    addListener(container.querySelector('#phone-ai-instruction-export-current-btn'), 'click', () => { void session.exportCurrent(); });
    addListener(container.querySelector('#phone-ai-instruction-export-all-btn'), 'click', () => { void session.exportAll(); });
    container.querySelectorAll('.phone-ai-message-up-btn').forEach((button) => addListener(button, 'click', () => {
        const index = Number(button.dataset.messageIndex);
        session.moveMessage(readDraft(), index, index - 1);
    }));
    container.querySelectorAll('.phone-ai-message-down-btn').forEach((button) => addListener(button, 'click', () => {
        const index = Number(button.dataset.messageIndex);
        session.moveMessage(readDraft(), index, index + 1);
    }));
    container.querySelectorAll('.phone-ai-message-delete-btn').forEach((button) => addListener(button, 'click', () => {
        session.deleteMessage(readDraft(), Number(button.dataset.messageIndex));
    }));
}

export function createAiInstructionPresetsPage(ctx) {
    const session = createAiInstructionPresetSession(ctx);
    const paint = () => {
        ctx.container.innerHTML = buildAiInstructionPresetsPageHtml(session.state);
        bindAiInstructionPresetInteractions(ctx, session);
    };
    return {
        mount() {
            session.activate();
            paint();
            void session.load('', false);
        },
        update() { paint(); },
        dispose() { session.deactivate(); },
    };
}

export function renderAiInstructionPresetsPage(ctx) {
    createAiInstructionPresetsPage(ctx).mount();
}
