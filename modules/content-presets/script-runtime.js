export function executeContentPresetScript(options = {}) {
    const { documentRef = document, mode = 'classic', source = '', mimeType = 'text/javascript', timeoutMs = 10000, signal = null } = options;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('脚本加载已取消', 'AbortError')); return; }
        const script = documentRef.createElement('script');
        const url = URL.createObjectURL(new Blob([String(source)], { type: mimeType }));
        let settled = false;
        let timer = null;
        const releaseFailedHandle = () => {
            script.remove();
            URL.revokeObjectURL(url);
        };
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', handleAbort);
            script.onload = null;
            script.onerror = null;
            if (error) {
                releaseFailedHandle();
                reject(error);
                return;
            }
            resolve({ script, url });
        };
        const handleAbort = () => finish(new DOMException('脚本加载已取消', 'AbortError'));
        signal?.addEventListener?.('abort', handleAbort, { once: true });
        timer = setTimeout(() => finish(new Error('玉子美化脚本加载超时')), timeoutMs);
        script.type = mode === 'module' ? 'module' : 'text/javascript';
        script.src = url;
        script.onload = () => finish();
        script.onerror = () => finish(new Error(`玉子美化 ${mode} 脚本加载失败`));
        try {
            documentRef.head.appendChild(script);
        } catch (error) {
            finish(error);
        }
    });
}
