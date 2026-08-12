export function observeFinalPromptForViewer({ model = '', messages = [] } = {}) {
    try {
        const hostWindow = globalThis.window;
        if (!hostWindow || typeof hostWindow.postMessage !== 'function') return;
        const targetOrigin = hostWindow.location?.origin;
        if (typeof targetOrigin !== 'string' || targetOrigin === 'null') return;
        if (new URL(targetOrigin).origin !== targetOrigin) return;

        const promptMessages = Array.isArray(messages)
            ? messages
                .filter((message) => typeof message?.role === 'string' && typeof message?.content === 'string')
                .map((message) => ({ role: message.role, content: message.content }))
            : [];
        if (promptMessages.length === 0) return;

        hostWindow.postMessage({
            _fpv: true,
            model: String(model ?? ''),
            messages: promptMessages,
        }, targetOrigin);
    } catch {
        // Prompt observation must never block the real request.
    }
}
