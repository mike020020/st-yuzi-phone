export const AI_INSTRUCTION_PROMPT_ROLES = Object.freeze(['system', 'user', 'assistant']);

function asText(value) {
    return String(value || '').trim();
}

export function normalizeAiInstructionMessages(messages) {
    return (Array.isArray(messages) ? messages : []).map(message => ({
        id: asText(message?.id),
        name: asText(message?.name) || '未命名消息块',
        role: AI_INSTRUCTION_PROMPT_ROLES.includes(message?.role) ? message.role : 'system',
        content: String(message?.content || ''),
    }));
}

export function createAiInstructionDraft(preset = {}) {
    return {
        presetId: asText(preset.presetId),
        name: asText(preset.name),
        isBuiltIn: preset.isBuiltIn === true,
        messages: normalizeAiInstructionMessages(preset.messages),
    };
}

export function createNewAiInstructionDraft() {
    return createAiInstructionDraft({
        name: '新建 AI 指令预设',
        messages: [{ id: '', name: '新消息块', role: 'system', content: '' }],
    });
}

function isMisreadControlMessage(message) {
    return message.name === '未命名消息块'
        && message.role === 'system'
        && message.content === '';
}

export function findMisreadControlMessages(messages) {
    const normalized = normalizeAiInstructionMessages(messages);
    const indexes = [];
    let runStart = -1;
    normalized.forEach((message, index) => {
        if (isMisreadControlMessage(message)) {
            if (runStart === -1) runStart = index;
            return;
        }
        if (runStart !== -1 && index - runStart >= 3) {
            for (let runIndex = runStart; runIndex < index; runIndex += 1) indexes.push(runIndex);
        }
        runStart = -1;
    });
    if (runStart !== -1 && normalized.length - runStart >= 3) {
        for (let runIndex = runStart; runIndex < normalized.length; runIndex += 1) indexes.push(runIndex);
    }
    return { messages: normalized, indexes };
}

export function removeMisreadControlMessages(messages) {
    const result = findMisreadControlMessages(messages);
    const indexes = new Set(result.indexes);
    return {
        messages: result.messages.filter((_, index) => !indexes.has(index)),
        removedCount: indexes.size,
    };
}
