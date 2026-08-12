import { clampNumber } from './core.js';

function imageFileRecord(file) {
    return Object.freeze({
        file,
        name: String(file?.name || ''),
        type: String(file?.type || ''),
        size: Number(file?.size) || 0,
    });
}

export function pickImageFiles(callback, options = {}) {
    const maxSizeMB = clampNumber(options.maxSizeMB, 1, 64, 8);
    const onError = typeof options.onError === 'function' ? options.onError : null;
    const runtime = options.runtime || options.pageRuntime || null;
    const isDisposed = () => !!runtime?.isDisposed?.();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = options.multiple !== false;
    input.style.display = 'none';
    document.body.appendChild(input);

    let cleaned = false;
    const cleanupAfterPickerCloses = () => {
        setTimeout(() => {
            if (!input.files?.length) cleanup();
        }, 300);
    };
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        window.removeEventListener('focus', cleanupAfterPickerCloses);
        try {
            input.remove();
        } catch {}
    };
    const addListener = runtime?.addEventListener
        ? (...args) => runtime.addEventListener(...args)
        : (target, type, handler, listenerOptions) => {
            target.addEventListener(type, handler, listenerOptions);
            return () => target.removeEventListener(type, handler, listenerOptions);
    };
    runtime?.registerCleanup?.(cleanup);
    window.addEventListener('focus', cleanupAfterPickerCloses, { once: true });

    addListener(input, 'change', async () => {
        const files = [...(input.files || [])];
        if (files.length === 0) {
            cleanup();
            return;
        }

        const invalidFile = files.find((file) => !String(file.type || '').startsWith('image/'));
        if (invalidFile) {
            onError?.(`${invalidFile.name || '所选文件'}不是图片文件`);
            cleanup();
            return;
        }

        const maxBytes = Math.max(1, maxSizeMB) * 1024 * 1024;
        const oversizedFile = files.find((file) => Number(file.size) > maxBytes);
        if (oversizedFile) {
            onError?.(`${oversizedFile.name || '所选图片'}超过 ${maxSizeMB}MB`);
            cleanup();
            return;
        }

        try {
            if (isDisposed()) return;
            await Promise.resolve(callback(Object.freeze(files.map(imageFileRecord))));
        } catch (error) {
            onError?.(error?.message || '图片处理失败');
        } finally {
            cleanup();
        }
    });

    input.click();
}
