function element(tagName, className = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    return node;
}

function button(label, className) {
    const node = element('button', className);
    node.type = 'button';
    node.textContent = label;
    return node;
}

function defaultDescription(fileName, index) {
    return String(fileName || '').trim().replace(/\.[^.]+$/u, '') || `新表情 ${index + 1}`;
}

export function createStickerUploadDialog({ files = [], close, save, onSaved } = {}) {
    const entries = files.map((record, index) => {
        const file = record?.file;
        const previewUrl = URL.createObjectURL(file);
        const row = element('label', 'yuzi-qq-sticker-upload-row');
        const preview = element('img', 'yuzi-qq-sticker-upload-preview');
        preview.alt = '';
        preview.src = previewUrl;
        const details = element('span', 'yuzi-qq-sticker-upload-details');
        const name = element('span', 'yuzi-qq-sticker-upload-name');
        name.textContent = `${index + 1}. ${record?.name || `表情 ${index + 1}`}`;
        const description = element('textarea', 'yuzi-qq-sticker-description-input');
        description.placeholder = '表情含义';
        description.setAttribute('aria-label', `${name.textContent}的表情含义`);
        description.value = defaultDescription(record?.name, index);
        description.maxLength = 4000;
        description.rows = 2;
        details.append(name, description);
        row.append(preview, details);
        return { file, previewUrl, row, description };
    });

    const content = element('div', 'yuzi-qq-dialog-form yuzi-qq-sticker-upload-form');
    const list = element('div', 'yuzi-qq-sticker-upload-list');
    entries.forEach(({ row }) => list.append(row));
    const status = element('p', 'yuzi-qq-form-error');
    content.append(list, status);

    const cancel = button('取消', 'yuzi-qq-secondary-button');
    cancel.addEventListener('click', () => close?.());
    const confirm = button(`保存 ${entries.length} 个表情`, 'yuzi-qq-primary-button');
    confirm.addEventListener('click', async () => {
        const descriptions = entries.map(({ description }) => description.value.trim());
        const invalidIndex = descriptions.findIndex((description) => !description);
        if (invalidIndex >= 0) {
            status.textContent = `请填写第 ${invalidIndex + 1} 个表情的含义`;
            entries[invalidIndex].description.focus();
            return;
        }
        confirm.disabled = true;
        cancel.disabled = true;
        status.textContent = '';
        try {
            const result = await save?.(entries.map(({ file }, index) => ({
                description: descriptions[index],
                blob: file,
            })));
            if (!result?.ok) throw new Error(result?.error?.message || '表情保存失败');
            close?.();
            await onSaved?.(result);
        } catch (error) {
            confirm.disabled = false;
            cancel.disabled = false;
            status.textContent = error?.message || '表情保存失败';
        }
    });

    return Object.freeze({
        content,
        actions: Object.freeze([cancel, confirm]),
        focus() {
            entries[0]?.description.select();
        },
        dispose() {
            entries.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
        },
    });
}
