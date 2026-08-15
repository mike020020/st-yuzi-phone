const ALLOWED_ELEMENTS = new Set([
    'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'button',
    'form', 'label', 'input', 'textarea', 'select', 'option', 'p', 'span',
    'strong', 'em', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

const ALLOWED_ATTRIBUTES = new Set([
    'class', 'id', 'role', 'data-action', 'data-field', 'type', 'name', 'value',
    'disabled', 'checked', 'selected', 'for', 'placeholder', 'title',
]);

let nextSceneRootId = 0;

function controlledHtmlError(message, details = {}) {
    const error = new Error(message);
    error.name = 'YuziPhoneControlledHtmlError';
    error.code = 'YUZI_CONTROLLED_HTML_REJECTED';
    error.details = Object.freeze({ ...details });
    return error;
}

function createSceneRootId() {
    nextSceneRootId += 1;
    return `yuzi-scene-${nextSceneRootId}`;
}

function isAllowedAttribute(name) {
    return ALLOWED_ATTRIBUTES.has(name) || name.startsWith('aria-');
}

function assertAllowedElement(element) {
    const tagName = String(element.tagName || '').toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tagName)) {
        throw controlledHtmlError('受控 HTML 包含不允许的元素', { tagName });
    }
    for (const attribute of element.attributes) {
        const name = String(attribute.name || '').toLowerCase();
        if (!isAllowedAttribute(name)) {
            throw controlledHtmlError('受控 HTML 包含不允许的属性', { tagName, attribute: name });
        }
    }
}

function validateBrowserHtml(html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const visit = (node) => {
        if (node.nodeType === 3) return;
        if (node.nodeType !== 1) {
            throw controlledHtmlError('受控 HTML 包含不允许的节点');
        }
        assertAllowedElement(node);
        for (const child of node.childNodes) visit(child);
    };
    for (const node of document.body.childNodes) visit(node);
    return document.body.innerHTML;
}

function validateFallbackHtml(html) {
    if (/<!--|<!doctype/i.test(html)) {
        throw controlledHtmlError('受控 HTML 包含不允许的节点');
    }
    const tags = html.match(/<[^>]*>/g) || [];
    for (const tag of tags) {
        const match = /^<\/?\s*([a-z][a-z0-9-]*)\b[^>]*>$/i.exec(tag);
        if (!match || !ALLOWED_ELEMENTS.has(match[1].toLowerCase())) {
            throw controlledHtmlError('受控 HTML 包含不允许的元素');
        }
        if (tag.startsWith('</')) continue;
        const attributes = tag.slice(match[0].indexOf(match[1]) + match[1].length, -1);
        for (const attribute of attributes.matchAll(/\s+([a-z_:][a-z0-9:._-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi)) {
            const name = attribute[1].toLowerCase();
            if (!isAllowedAttribute(name)) {
                throw controlledHtmlError('受控 HTML 包含不允许的属性', { attribute: name });
            }
        }
    }
    return html;
}

function validateHtml(html) {
    if (typeof html !== 'string') {
        throw controlledHtmlError('受控 HTML 必须是字符串');
    }
    return typeof DOMParser === 'function' ? validateBrowserHtml(html) : validateFallbackHtml(html);
}

function scopeStyles(styles, sceneRootId) {
    if (styles === undefined || styles === null || styles === '') return '';
    if (typeof styles !== 'string') {
        throw controlledHtmlError('受控 HTML 样式必须是字符串');
    }
    const normalizedStyles = styles.trim();
    if (!normalizedStyles) return '';
    if (/@|url\s*\(|expression\s*\(|<\/?style\b/i.test(normalizedStyles)) {
        throw controlledHtmlError('受控 HTML 样式包含不允许的规则');
    }
    const root = `[data-yuzi-controlled-scene="${sceneRootId}"]`;
    let cursor = 0;
    let output = '';
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const rule of normalizedStyles.matchAll(rulePattern)) {
        if (rule.index !== cursor) {
            throw controlledHtmlError('受控 HTML 样式语法无效');
        }
        const selectors = rule[1].trim();
        if (!selectors) throw controlledHtmlError('受控 HTML 样式选择器不能为空');
        const scopedSelectors = selectors.split(',').map((selector) => {
            const normalized = selector.trim();
            if (!normalized || /(^|[^\\]):root\b|\b(?:html|body)\b/i.test(normalized)) {
                throw controlledHtmlError('受控 HTML 样式选择器不允许越过 Scene 根节点');
            }
            return `${root} ${normalized}`;
        });
        output += `${scopedSelectors.join(', ')} {${rule[2]}}`;
        cursor = rule.index + rule[0].length;
    }
    if (cursor !== normalizedStyles.length) {
        throw controlledHtmlError('受控 HTML 样式语法无效');
    }
    return output;
}

/**
 * Validates inert, declarative markup for a public Scene and scopes its CSS to
 * the generated root wrapper. It never inserts markup, fetches a URL, or
 * evaluates code; the route renderer owns the subsequent DOM mount.
 */
export function sanitizeControlledHtml(html, styles = '') {
    const safeHtml = validateHtml(html);
    const sceneRootId = createSceneRootId();
    return Object.freeze({
        html: `<div data-yuzi-controlled-scene="${sceneRootId}">${safeHtml}</div>`,
        styles: scopeStyles(styles, sceneRootId),
    });
}
