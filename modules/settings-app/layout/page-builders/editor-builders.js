import {
    buildSettingsHeroHtml,
    buildSettingsPageFrame,
    buildSettingsSectionHtml,
    buildSettingsSummaryListHtml,
} from '../primitives.js';
import { PHONE_ICONS } from '../../../phone-home/icons.js';
import { escapeHtml, escapeHtmlAttr } from '../../../utils/dom-escape.js';
import { buildShellRegionHtml } from '../../../view-regions.js';

export function buildPromptEditorPageHtml({ title, isNew, promptEditorName, promptEditorContent }) {
    const heroHtml = buildSettingsHeroHtml({
        eyebrow: isNew ? '新建预设' : '编辑预设',
        title: title || 'AI 指令预设编辑器',
        description: '当前页面为兼容入口，实际推荐使用独立的“AI 指令预设”一级页进行分段编辑。',
        chips: [
            { text: isNew ? '创建新预设' : '编辑现有预设', tone: 'info' },
            { text: '兼容编辑入口', tone: 'soft' },
        ],
    });

    const bodyHtml = `
        ${buildSettingsSectionHtml({
            title: '预设名称',
            desc: '此兼容页仍保留名称与 JSON 内容编辑能力。',
            bodyHtml: `
                <input type="text" id="phone-prompt-editor-name" class="phone-settings-input phone-settings-input-full"
                    placeholder="请输入预设名称" value="${escapeHtmlAttr(promptEditorName || '')}">
            `,
        })}

        ${buildSettingsSectionHtml({
            title: '片段 JSON',
            desc: '推荐返回上一级使用分段片段编辑器；这里仅保留兼容式 JSON 编辑。未在 JSON 中提供 mediaMarkers 时会保留当前预设媒体标记，导入完整预设 JSON 可覆盖媒体标记。',
            bodyHtml: `
                <textarea id="phone-prompt-editor-content" class="phone-settings-textarea"
                    placeholder="请输入 AI 指令片段 JSON..." rows="14">${escapeHtml(promptEditorContent || '')}</textarea>
                <div class="phone-settings-action-row">
                    <button type="button" class="phone-settings-btn" id="phone-prompt-upload-btn">
                        ${PHONE_ICONS.upload}
                        <span>导入 JSON</span>
                    </button>
                    <button type="button" class="phone-settings-btn phone-settings-btn-ghost" id="phone-prompt-reset-default-btn">
                        <span>重置为默认片段</span>
                    </button>
                </div>
            `,
        })}

        ${buildSettingsSectionHtml({
            title: '保存操作',
            desc: '保存后会写入当前 AI 指令预设仓库。',
            bodyHtml: `
                <div class="phone-settings-action">
                    <button type="button" class="phone-settings-btn phone-settings-btn-primary" id="phone-prompt-save-btn">
                        <span>${escapeHtml(isNew ? '创建并启用预设' : '保存并启用预设')}</span>
                    </button>
                </div>
            `,
        })}
    `;

    return buildSettingsPageFrame({
        title,
        heroHtml,
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml,
    });
}

export function buildAiInstructionPresetsPageHtml({
    currentPresetName,
    draftPresetName,
    presetOptions,
    presetCount,
    imageMarkerValue,
    videoMarkerValue,
    segmentCardsHtml,
}) {
    const resolvedCurrentPresetName = String(currentPresetName || '默认实时回复预设').trim() || '默认实时回复预设';
    const resolvedDraftPresetName = String(draftPresetName || resolvedCurrentPresetName).trim() || resolvedCurrentPresetName;
    const summaryHtml = buildSettingsSummaryListHtml([
        { label: '当前启用', value: resolvedCurrentPresetName },
        { label: '编辑对象', value: resolvedDraftPresetName },
        { label: '预设总数', value: String(Number.isFinite(Number(presetCount)) ? Number(presetCount) : 0) },
    ]);

    const heroHtml = buildSettingsHeroHtml({
        eyebrow: 'AI 指令预设',
        title: '实时回复预设仓库',
        description: '按段管理消息记录表实时回复的提示词结构，支持主槽位、角色、导入导出与当前预设切换。',
        chips: [
            { text: `当前预设 · ${resolvedCurrentPresetName}`, tone: 'info' },
            { text: '分段结构编辑', tone: 'soft' },
            { text: '支持导入导出', tone: 'neutral' },
        ],
        asideHtml: summaryHtml,
    });

    const bodyHtml = `
        ${buildSettingsSectionHtml({
            title: '预设工具条',
            desc: '参考数据库预设管理模式：先选预设，再覆盖保存、另存为新、导入导出。',
            bodyHtml: `
                ${summaryHtml}
                <div class="phone-ai-preset-toolbar">
                    <div class="phone-ai-preset-toolbar-main">
                        <label class="phone-settings-label" for="phone-ai-instruction-preset-select">选择预设</label>
                        <select id="phone-ai-instruction-preset-select" class="phone-settings-select phone-ai-preset-select">
                            ${presetOptions}
                        </select>
                    </div>
                    <label class="phone-settings-field-inline phone-settings-field-full phone-ai-preset-name-field">
                        <span>预设名称</span>
                        <input id="phone-ai-instruction-preset-name" class="phone-settings-input phone-settings-input-full" value="${escapeHtmlAttr(resolvedDraftPresetName)}" placeholder="输入预设名称">
                    </label>
                </div>
                <div class="phone-settings-action-row phone-ai-preset-action-row">
                    <button type="button" class="phone-settings-btn phone-settings-btn-primary" id="phone-ai-instruction-apply-btn">设为当前</button>
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-save-btn">覆盖保存</button>
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-save-as-btn">另存为新</button>
                    <button type="button" class="phone-settings-btn phone-settings-btn-danger" id="phone-ai-instruction-delete-btn">删除预设</button>
                </div>
                <div class="phone-settings-action-row phone-ai-preset-action-row">
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-import-btn">导入预设</button>
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-export-btn">导出当前</button>
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-export-all-btn">导出全部</button>
                    <button type="button" class="phone-settings-btn phone-settings-btn-ghost" id="phone-ai-instruction-reset-btn">恢复默认</button>
                </div>
                <input type="file" id="phone-ai-instruction-import-input" accept="application/json,.json,.txt" style="display:none">
            `,
        })}

        ${buildSettingsSectionHtml({
            title: '媒体标记',
            desc: '配置历史消息中图片与视频描述的前缀；这些值会写入实时回复历史 prompt，不只是界面显示文案。',
            bodyHtml: `
                <div class="phone-ai-preset-media-grid">
                    <label class="phone-ai-preset-segment-field">
                        <span>图片前缀</span>
                        <input id="phone-ai-instruction-image-prefix" class="phone-settings-input phone-settings-input-full" value="${escapeHtmlAttr(imageMarkerValue || '')}" placeholder="例如：[图片]">
                    </label>
                    <label class="phone-ai-preset-segment-field">
                        <span>视频前缀</span>
                        <input id="phone-ai-instruction-video-prefix" class="phone-settings-input phone-settings-input-full" value="${escapeHtmlAttr(videoMarkerValue || '')}" placeholder="例如：[视频]">
                    </label>
                </div>
            `,
        })}

        ${buildSettingsSectionHtml({
            title: '分段结构编辑器',
            desc: '按段编辑 role、主槽位、名称与正文，整体结构对齐数据库的 promptGroup 形式。',
            bodyHtml: `
                <div class="phone-ai-preset-add-row is-top">
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-add-top-btn">+ 在顶部添加片段</button>
                </div>
                <div id="phone-ai-instruction-segment-stack" class="phone-ai-preset-segment-stack">
                    ${segmentCardsHtml || '<div class="phone-empty-msg">暂无分段内容</div>'}
                </div>
                <div class="phone-ai-preset-add-row is-bottom">
                    <button type="button" class="phone-settings-btn" id="phone-ai-instruction-add-bottom-btn">+ 在底部添加片段</button>
                </div>
                <div class="phone-settings-note">
                    主槽位 A / B 会在普通片段之前按顺序拼接；未分配槽位的片段保持原顺序。导入或保存后的片段默认都会参与 prompt。
                </div>
                <div class="phone-settings-note">
                    实时回复支持多气泡输出协议：使用 <code>消息1：</code>、<code>正文：</code>、<code>图片描述：</code>、<code>视频描述：</code>，需要连发时继续写 <code>消息2：</code>，最多 4 条；没有图片或视频时对应描述写 <code>none</code>。
                </div>
                <div class="phone-settings-note">
                    <strong>可用占位符：</strong><br>
                    <code>{{targetCharacterName}}</code>：当前聊天目标角色名。<br>
                    <code>{{conversationTitle}}</code>：当前会话标题。<br>
                    <code>{{worldbookText}}</code>：当前选中的世界书内容汇总。<br>
                    <code>{{storyContext}}</code>：正文最近的 AI 剧情上下文。<br>
                    若某个片段引用了以上占位符，但对应内容当前为空，该片段会在运行时被自动跳过。
                </div>
            `,
        })}
    `;

    return buildSettingsPageFrame({
        title: 'AI 指令预设',
        heroHtml,
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml,
    });
}

export function buildApiPromptConfigPageHtml({
    apiAvailability,
    apiPresetOptions,
    plotPresetOptions,
    phoneChatApiPresetOptions,
    phoneChatUseStoryContext,
    phoneChatStoryContextTurns,
    phoneChatMaxHistoryMessages,
    phoneChatMaxReplyTokens,
    phoneChatRequestTimeoutMs,
    phoneChatWorldbookMaxEntries,
    phoneChatWorldbookMaxChars,
    worldbookOptions,
    worldbookLoading,
    worldbookSearchQuery,
    worldbookSourceModeOptions,
    worldbookSelectDisabled,
    worldbookSearchDisabled,
    worldbookActionDisabled,
}) {
    const heroHtml = buildSettingsHeroHtml({
        eyebrow: 'AI 上下文与世界书',
        title: '聊天配置与世界书工作台',
        description: '这里统一管理聊天 API、正文上下文、历史裁剪、回复参数与世界书注入策略；AI 指令预设已拆到独立一级入口。',
        chips: [
            { text: apiAvailability.ok ? '数据库接口正常' : '数据库接口异常', tone: apiAvailability.ok ? 'success' : 'danger' },
            { text: phoneChatUseStoryContext ? `正文上下文 ${phoneChatStoryContextTurns} 轮` : '未读取正文上下文', tone: 'soft' },
            { text: `历史 ${phoneChatMaxHistoryMessages} 条 / 回复 ${phoneChatMaxReplyTokens} token`, tone: 'soft' },
            { text: '预设仓库已独立', tone: 'info' },
        ],
    });
    const heroRegionHtml = buildShellRegionHtml({
        region: 'api-prompt-hero',
        contentHtml: heroHtml,
    });
    const apiStatusRegionHtml = buildShellRegionHtml({
        region: 'api-prompt-api-status',
        contentHtml: !apiAvailability.ok
            ? `<div class="phone-settings-inline-status is-danger"><span class="phone-settings-inline-status-dot"></span><span class="phone-settings-inline-status-text">${escapeHtml(apiAvailability.message || '数据库 API 不可用')}</span></div>`
            : '',
    });

    const apiPresetsSectionHtml = buildShellRegionHtml({
        region: 'api-prompt-api-presets',
        contentHtml: buildSettingsSectionHtml({
            title: 'API 预设',
            desc: '分别配置填表与剧情推进所使用的接口预设，方便在不同任务场景间切换。',
            bodyHtml: `
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label">填表API预设</label>
                    <select id="phone-table-api-preset-select" class="phone-settings-select" ${apiAvailability.ok ? '' : 'disabled'}>
                        ${apiPresetOptions}
                    </select>
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label">剧情推进API预设</label>
                    <select id="phone-plot-api-preset-select" class="phone-settings-select" ${apiAvailability.ok ? '' : 'disabled'}>
                        ${plotPresetOptions}
                    </select>
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label">聊天API预设</label>
                    <select id="phone-chat-api-preset-select" class="phone-settings-select" ${apiAvailability.ok ? '' : 'disabled'}>
                        ${phoneChatApiPresetOptions}
                    </select>
                </div>
            `,
        }),
    });

    const storyContextSectionHtml = buildShellRegionHtml({
        region: 'api-prompt-story-context',
        contentHtml: buildSettingsSectionHtml({
            title: '正文上下文',
            desc: '决定手机聊天是否读取正文最近上下文，以及读取的轮数。',
            bodyHtml: `
                <div class="phone-settings-field-row phone-settings-field-row-compact">
                    <label class="phone-settings-label" for="phone-chat-use-story-context">读取AI上下文</label>
                    <input type="checkbox" id="phone-chat-use-story-context" class="phone-settings-switch" ${phoneChatUseStoryContext ? 'checked' : ''}>
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-story-context-turns">读取轮数</label>
                    <input type="number" id="phone-chat-story-context-turns" class="phone-settings-input" min="0" max="20" step="1"
                        value="${escapeHtmlAttr(String(phoneChatStoryContextTurns))}" ${phoneChatUseStoryContext ? '' : 'disabled'}>
                </div>
                <p class="phone-settings-desc">该页面只负责上下文注入和 API 选择；system 指令内容请到独立的“AI 指令预设”页编辑。</p>
            `,
        }),
    });

    const runtimeParamsSectionHtml = buildShellRegionHtml({
        region: 'api-prompt-runtime-params',
        contentHtml: buildSettingsSectionHtml({
            title: '实时回复 Prompt 参数',
            desc: '这些参数会直接进入消息记录表的实时回复运行时，分别控制历史裁剪、回复长度、超时和世界书裁剪范围。',
            bodyHtml: `
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-max-history-messages">历史消息条数</label>
                    <input type="number" id="phone-chat-max-history-messages" class="phone-settings-input" min="0" max="50" step="1"
                        value="${escapeHtmlAttr(String(phoneChatMaxHistoryMessages))}">
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-max-reply-tokens">回复最大 token</label>
                    <input type="number" id="phone-chat-max-reply-tokens" class="phone-settings-input" min="64" max="4096" step="1"
                        value="${escapeHtmlAttr(String(phoneChatMaxReplyTokens))}">
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-request-timeout-ms">请求超时（毫秒）</label>
                    <input type="number" id="phone-chat-request-timeout-ms" class="phone-settings-input" min="15000" max="300000" step="1000"
                        value="${escapeHtmlAttr(String(phoneChatRequestTimeoutMs))}">
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-worldbook-max-entries">世界书最大条目数</label>
                    <input type="number" id="phone-chat-worldbook-max-entries" class="phone-settings-input" min="0" max="100" step="1"
                        value="${escapeHtmlAttr(String(phoneChatWorldbookMaxEntries))}">
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label" for="phone-chat-worldbook-max-chars">世界书最大字符数</label>
                    <input type="number" id="phone-chat-worldbook-max-chars" class="phone-settings-input" min="0" max="20000" step="100"
                        value="${escapeHtmlAttr(String(phoneChatWorldbookMaxChars))}">
                </div>
            `,
        }),
    });

    const worldbookWorkbenchSectionHtml = buildShellRegionHtml({
        region: 'api-prompt-worldbook-workbench',
        contentHtml: buildSettingsSectionHtml({
            title: '世界书工作台',
            desc: '切换世界书来源、筛选条目并批量维护选中状态。',
            actionsHtml: `
                <button type="button" class="phone-settings-btn phone-settings-btn-ghost" id="phone-worldbook-refresh" ${worldbookActionDisabled ? 'disabled' : ''}>
                    <span>刷新</span>
                </button>
            `,
            bodyHtml: `
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label">读取模式</label>
                    <select id="phone-worldbook-source-mode" class="phone-settings-select">
                        ${worldbookSourceModeOptions}
                    </select>
                </div>
                <div class="phone-settings-field-row">
                    <label class="phone-settings-label">选择世界书</label>
                    <select id="phone-worldbook-select" class="phone-settings-select" ${worldbookSelectDisabled ? 'disabled' : ''}>
                        ${worldbookOptions}
                    </select>
                </div>
                <div class="phone-settings-field-row">
                    <input type="text" id="phone-worldbook-search" class="phone-settings-input phone-settings-input-full"
                        placeholder="搜索条目名称..." value="${escapeHtmlAttr(worldbookSearchQuery)}" ${worldbookSearchDisabled ? 'disabled' : ''}>
                </div>
                <div class="phone-settings-action-row">
                    <button type="button" class="phone-settings-btn" id="phone-worldbook-select-all" ${worldbookActionDisabled ? 'disabled' : ''}>
                        <span>全选</span>
                    </button>
                    <button type="button" class="phone-settings-btn" id="phone-worldbook-deselect-all" ${worldbookActionDisabled ? 'disabled' : ''}>
                        <span>取消全选</span>
                    </button>
                </div>
                <div id="phone-worldbook-entries" class="phone-worldbook-entries">
                    ${worldbookLoading ? '<div class="phone-worldbook-loading">加载中...</div>' : ''}
                </div>
                <div class="phone-worldbook-status">
                    <span id="phone-worldbook-status-text">请先选择世界书</span>
                </div>
            `,
        }),
    });

    const bodyHtml = `
        ${apiStatusRegionHtml}
        ${apiPresetsSectionHtml}
        ${storyContextSectionHtml}
        ${runtimeParamsSectionHtml}
        ${worldbookWorkbenchSectionHtml}
    `;

    return buildSettingsPageFrame({
        title: 'AI 上下文与世界书',
        heroHtml: heroRegionHtml,
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml,
    });
}

export function buildBeautifyTemplatePageHtml(viewModel = {}) {
    const presets = Array.isArray(viewModel.presets) ? viewModel.presets : [];
    const tables = Array.isArray(viewModel.tables) ? viewModel.tables : [];
    const status = String(viewModel.status || 'loading');
    const heroHtml = buildSettingsHeroHtml({
        eyebrow: '模板工坊',
        title: '模板工坊',
        description: '导入多单表完整预设，并按真实表精确选择当前美化。未绑定或运行失败时保留原展示。',
    });

    const statusHtml = status === 'loading'
        ? '<div class="phone-settings-note">正在读取独立模板仓库…</div>'
        : status === 'unavailable' || status === 'error'
            ? `<div class="phone-settings-note">模板仓库不可用：${escapeHtml(viewModel.error?.message || '未知错误')}。现有页面仍使用原展示。</div>`
            : '';

    const presetCardsHtml = presets.length > 0
        ? presets.map((preset) => {
            const issues = Array.isArray(preset.issues) ? preset.issues : [];
            const issueHtml = issues.length > 0
                ? `<ul class="phone-settings-list">${issues.map(issue => `<li><strong>${escapeHtml(issue.code || 'issue')}</strong>：${escapeHtml(issue.message || '')}</li>`).join('')}</ul>`
                : '<div class="phone-settings-note">未记录导入问题。</div>';
            return `
                <article class="phone-settings-card">
                    <div class="phone-settings-card-title">${escapeHtml(preset.name || preset.id)}</div>
                    <div class="phone-settings-card-desc">ID：${escapeHtml(preset.id)} · 版本：${escapeHtml(preset.version || '未声明')} · 作者：${escapeHtml(preset.author || '未声明')} · ${Number(preset.items?.length || 0)} 个单表项</div>
                    ${issueHtml}
                    <div class="phone-settings-action">
                        <button type="button" class="phone-settings-btn" data-action="export" data-preset-id="${escapeHtmlAttr(preset.id)}">导出</button>
                        <button type="button" class="phone-settings-btn phone-settings-btn-danger" data-action="delete" data-preset-id="${escapeHtmlAttr(preset.id)}">删除</button>
                    </div>
                </article>`;
        }).join('')
        : '<div class="phone-settings-note">尚未导入玉子美化预设。</div>';

    const tableCardsHtml = tables.length > 0
        ? tables.map((table) => {
            const candidates = Array.isArray(table.candidates) ? table.candidates : [];
            const active = table.active;
            const candidateHtml = candidates.length > 0
                ? candidates.map((candidate) => {
                    const selected = active?.presetId === candidate.presetId && active?.itemId === candidate.itemId;
                    return `
                        <div class="phone-settings-row">
                            <div class="phone-settings-row-main">
                                <div class="phone-settings-row-title">${escapeHtml(candidate.preset?.name || candidate.presetId)} / ${escapeHtml(candidate.item?.name || candidate.itemId)}</div>
                                <div class="phone-settings-row-desc">${selected ? '当前已启用' : '表名与声明字段精确匹配'}</div>
                            </div>
                            <button type="button" class="phone-settings-btn" data-action="activate" data-sheet-key="${escapeHtmlAttr(table.sheetKey)}" data-preset-id="${escapeHtmlAttr(candidate.presetId)}" data-item-id="${escapeHtmlAttr(candidate.itemId)}" ${selected ? 'disabled' : ''}>${selected ? '当前' : '设为当前'}</button>
                        </div>`;
                }).join('')
                : '<div class="phone-settings-note">没有匹配此表名与字段的可运行预设项。</div>';
            return `
                <article class="phone-settings-card">
                    <div class="phone-settings-card-title">${escapeHtml(table.tableName || table.sheetKey)}</div>
                    <div class="phone-settings-card-desc">sheetKey：${escapeHtml(table.sheetKey)} · 字段：${escapeHtml((table.headers || []).join('、') || '无')}</div>
                    ${candidateHtml}
                    <div class="phone-settings-action">
                        <button type="button" class="phone-settings-btn" data-action="clear" data-sheet-key="${escapeHtmlAttr(table.sheetKey)}" ${active ? '' : 'disabled'}>恢复默认</button>
                    </div>
                </article>`;
        }).join('')
        : '<div class="phone-settings-note">没有可配置的真实表。消息记录表不会出现在这里。</div>';

    const bodyHtml = `
        ${statusHtml}
        ${buildSettingsSectionHtml({
        title: '完整预设',
        desc: '同 ID 导入会要求确认；覆盖成功后清除该预设的全部表绑定，但不会自动启用或迁移同 itemId。',
        bodyHtml: `
            <div class="phone-settings-action">
                <button type="button" class="phone-settings-btn phone-settings-btn-primary" data-action="import">导入预设</button>
            </div>
            ${presetCardsHtml}
        `,
    })}
        ${buildSettingsSectionHtml({
        title: '真实表绑定',
        desc: '仅列出非消息记录表。候选匹配采用 Unicode NFKC、表名精确相等和声明字段包含规则。',
        bodyHtml: `${tableCardsHtml}<div class="phone-settings-action"><button type="button" class="phone-settings-btn phone-settings-btn-danger" data-action="clear-all">全部恢复默认</button></div>`,
    })}`;

    return buildSettingsPageFrame({
        title: '模板工坊',
        heroHtml,
        bodyClass: 'phone-app-body phone-settings-scroll phone-settings-open',
        bodyHtml,
    });
}
