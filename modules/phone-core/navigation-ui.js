import { PHONE_ICONS, PHONE_NAV_ICON_PATHS } from '../phone-home/icons.js';
import { escapeHtml, escapeHtmlAttr } from '../utils/dom-escape.js';

const VALID_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const BOOLEAN_ATTRIBUTES = new Set([
    'autofocus',
    'disabled',
    'formnovalidate',
    'hidden',
    'inert',
]);

function joinClassNames(...values) {
    return [...new Set(values
        .flatMap((value) => String(value ?? '').trim().split(/\s+/))
        .filter(Boolean))]
        .join(' ');
}

function getAttributeClassName(attributes = {}) {
    return joinClassNames(attributes.class, attributes.className);
}

function serializeAttributes(attributes = {}) {
    return Object.entries(attributes).map(([rawName, value]) => {
        const name = String(rawName || '').trim();
        const normalizedName = name.toLowerCase();
        if (
            !name
            || !VALID_ATTRIBUTE_NAME.test(name)
            || normalizedName === 'class'
            || normalizedName === 'classname'
            || normalizedName.startsWith('on')
            || value === null
            || value === undefined
        ) {
            return '';
        }

        if (BOOLEAN_ATTRIBUTES.has(normalizedName)) {
            return value === false ? '' : ` ${name}`;
        }

        return ` ${name}="${escapeHtmlAttr(value)}"`;
    }).join('');
}

function getButtonAttributes({ attributes = {}, action, label, disabled }) {
    const nextAttributes = {
        ...attributes,
        type: 'button',
        'aria-label': attributes['aria-label'] ?? label,
    };

    if (action !== undefined && nextAttributes['data-action'] === undefined) {
        nextAttributes['data-action'] = action;
    }

    const isDisabled = disabled === true || nextAttributes.disabled === true;
    if (isDisabled) {
        nextAttributes.disabled = true;
        nextAttributes['aria-disabled'] = 'true';
    }

    return nextAttributes;
}

function normalizeSwitchDirection(direction) {
    const normalizedDirection = String(direction || '').trim().toLowerCase();
    if (['previous', 'prev', 'back', 'left'].includes(normalizedDirection)) {
        return 'previous';
    }
    if (['next', 'forward', 'right'].includes(normalizedDirection)) {
        return 'next';
    }
    throw new TypeError(`Unsupported phone navigation direction: ${direction}`);
}

function getDirectionIcon(direction) {
    return normalizeSwitchDirection(direction) === 'previous'
        ? PHONE_ICONS.back
        : PHONE_ICONS.forward;
}

export function buildPhoneBackButton({
    className = '',
    attributes = {},
    label = '返回',
    disabled = false,
    action,
} = {}) {
    const classes = joinClassNames(
        'phone-nav-icon-button phone-nav-back',
        className,
        getAttributeClassName(attributes),
    );
    const buttonAttributes = getButtonAttributes({ attributes, action, label, disabled });

    return `<button class="${escapeHtmlAttr(classes)}"${serializeAttributes(buttonAttributes)}>${PHONE_ICONS.back}</button>`;
}

export function buildPhoneSwitchButton(direction, {
    className = '',
    attributes = {},
    label,
    disabled = false,
    action,
} = {}) {
    const normalizedDirection = normalizeSwitchDirection(direction);
    const accessibleLabel = label || (normalizedDirection === 'previous' ? '上一项' : '下一项');
    const classes = joinClassNames(
        `phone-nav-icon-button phone-nav-switch-button is-${normalizedDirection}`,
        className,
        getAttributeClassName(attributes),
    );
    const buttonAttributes = getButtonAttributes({
        attributes,
        action,
        label: accessibleLabel,
        disabled,
    });

    return `<button class="${escapeHtmlAttr(classes)}"${serializeAttributes(buttonAttributes)}>${getDirectionIcon(normalizedDirection)}</button>`;
}

export function buildPhoneNavTitleSwitcher({
    title = '',
    previousHtml = '',
    nextHtml = '',
    className = '',
    attributes = {},
} = {}) {
    const hasPrevious = String(previousHtml || '').trim() !== '';
    const hasNext = String(nextHtml || '').trim() !== '';
    const isTitleOnly = !hasPrevious && !hasNext;
    const classes = joinClassNames(
        'phone-nav-title-switcher',
        isTitleOnly ? 'is-title-only' : '',
        className,
        getAttributeClassName(attributes),
    );
    const previousSlot = hasPrevious
        ? previousHtml
        : '<span class="phone-nav-switch-spacer" aria-hidden="true"></span>';
    const nextSlot = hasNext
        ? nextHtml
        : '<span class="phone-nav-switch-spacer" aria-hidden="true"></span>';

    return `
        <div class="${escapeHtmlAttr(classes)}"${serializeAttributes(attributes)}>
            ${isTitleOnly ? '' : previousSlot}
            <span class="phone-nav-title">${escapeHtml(title)}</span>
            ${isTitleOnly ? '' : nextSlot}
        </div>
    `;
}

export function buildPhoneNavBar({
    leadingHtml,
    centerHtml,
    trailingHtml,
    backHtml = '',
    titleHtml = '',
    actionsHtml = '',
    className = '',
    attributes = {},
    embedded = false,
} = {}) {
    const classes = joinClassNames(
        'phone-nav-bar',
        embedded ? 'is-embedded' : '',
        className,
        getAttributeClassName(attributes),
    );
    const resolvedLeadingHtml = leadingHtml ?? backHtml;
    const resolvedCenterHtml = centerHtml ?? titleHtml;
    const resolvedTrailingHtml = trailingHtml ?? actionsHtml;

    return `
        <div class="${escapeHtmlAttr(classes)}"${serializeAttributes(attributes)}>
            <div class="phone-nav-leading">${resolvedLeadingHtml || ''}</div>
            <div class="phone-nav-center">${resolvedCenterHtml || ''}</div>
            <div class="phone-nav-trailing">${resolvedTrailingHtml || ''}</div>
        </div>
    `;
}

export function createPhoneNavIconElement(direction, documentRef = globalThis.document) {
    if (!documentRef || typeof documentRef.createElement !== 'function') {
        throw new TypeError('A DOM document is required to create a phone navigation icon');
    }

    const normalizedDirection = normalizeSwitchDirection(direction);
    const createSvgElement = (tagName) => typeof documentRef.createElementNS === 'function'
        ? documentRef.createElementNS('http://www.w3.org/2000/svg', tagName)
        : documentRef.createElement(tagName);
    const icon = createSvgElement('svg');
    const path = createSvgElement('path');

    Object.entries({
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
    }).forEach(([name, value]) => icon.setAttribute(name, value));
    path.setAttribute('d', PHONE_NAV_ICON_PATHS[normalizedDirection === 'previous' ? 'back' : 'forward']);
    icon.append(path);
    return icon;
}
