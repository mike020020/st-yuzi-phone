const DEFAULT_THRESHOLD = 42;
const DEFAULT_AXIS_THRESHOLD = 6;
const CLICK_SUPPRESS_MS = 500;

export function resolveConversationSwipe(start, end, { threshold = DEFAULT_THRESHOLD } = {}) {
    const initial = start && typeof start === 'object' ? start : {};
    const current = end && typeof end === 'object' ? end : {};
    const horizontal = Number(current.x) - Number(initial.x);
    const vertical = Math.abs(Number(current.y) - Number(initial.y));
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return 'ignore';
    if (vertical > Math.abs(horizontal)) return 'close';
    if (Math.abs(horizontal) < threshold) return 'ignore';
    return horizontal < 0 ? 'open' : 'close';
}

export function clampConversationSwipeOffset(offset, revealWidth) {
    const width = Math.max(0, Number(revealWidth) || 0);
    const value = Number(offset);
    if (!Number.isFinite(value) || width === 0) return 0;
    return Math.min(0, Math.max(-width, value));
}

export function bindConversationSwipeGesture({
    shell,
    row,
    deleteAction,
    threshold = DEFAULT_THRESHOLD,
    axisThreshold = DEFAULT_AXIS_THRESHOLD,
    onSettle = () => {},
} = {}) {
    if (!(shell instanceof HTMLElement) || !(row instanceof HTMLElement) || !(deleteAction instanceof HTMLElement)) {
        return () => {};
    }

    let activePointer = null;
    let suppressClickUntil = 0;

    const readRevealWidth = () => Math.max(
        1,
        deleteAction.getBoundingClientRect().width || deleteAction.offsetWidth || 0,
    );

    const resetDragVisual = (open) => {
        shell.classList.remove('is-dragging', 'is-revealing');
        shell.style.removeProperty('--yuzi-qq-swipe-offset');
        shell.classList.toggle('is-swiped', open);
    };

    const settle = (open, reason) => {
        resetDragVisual(open);
        onSettle({ open, reason });
    };

    const releasePointer = () => {
        const pointerId = activePointer?.pointerId;
        activePointer = null;
        if (pointerId == null) return;
        try {
            if (row.hasPointerCapture?.(pointerId)) row.releasePointerCapture(pointerId);
        } catch {
            // Losing capture during rerender is harmless; the visual state is already settled.
        }
    };

    const handlePointerDown = (event) => {
        if (event.isPrimary === false) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        activePointer = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startOpen: shell.classList.contains('is-swiped'),
            axis: '',
            verticalSettled: false,
        };
        try {
            row.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture is an enhancement; document hit testing still provides a usable fallback.
        }
    };

    const handlePointerMove = (event) => {
        const state = activePointer;
        if (!state || state.pointerId !== event.pointerId) return;

        const horizontal = event.clientX - state.startX;
        const vertical = event.clientY - state.startY;
        if (!state.axis) {
            if (Math.max(Math.abs(horizontal), Math.abs(vertical)) < axisThreshold) return;
            state.axis = Math.abs(horizontal) >= Math.abs(vertical) ? 'horizontal' : 'vertical';
        }

        if (state.axis === 'vertical') {
            if (!state.verticalSettled) {
                state.verticalSettled = true;
                settle(false, 'vertical');
            }
            return;
        }

        event.preventDefault();
        const revealWidth = readRevealWidth();
        const startOffset = state.startOpen ? -revealWidth : 0;
        const offset = clampConversationSwipeOffset(startOffset + horizontal, revealWidth);
        shell.classList.add('is-dragging');
        shell.classList.toggle('is-revealing', offset < 0);
        shell.style.setProperty('--yuzi-qq-swipe-offset', `${offset}px`);
    };

    const handlePointerUp = (event) => {
        const state = activePointer;
        if (!state || state.pointerId !== event.pointerId) return;

        const end = { x: event.clientX, y: event.clientY };
        if (state.axis === 'horizontal') {
            const direction = resolveConversationSwipe(
                { x: state.startX, y: state.startY },
                end,
                { threshold },
            );
            const open = direction === 'open'
                ? true
                : direction === 'close'
                    ? false
                    : state.startOpen;
            suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
            event.preventDefault();
            settle(open, direction);
        } else if (state.axis === 'vertical') {
            suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        }
        releasePointer();
    };

    const handlePointerCancel = (event) => {
        const state = activePointer;
        if (!state || state.pointerId !== event.pointerId) return;
        settle(state.axis === 'vertical' ? false : state.startOpen, 'cancel');
        releasePointer();
    };

    const handleLostPointerCapture = (event) => {
        if (!activePointer || activePointer.pointerId !== event.pointerId) return;
        settle(activePointer.axis === 'vertical' ? false : activePointer.startOpen, 'capture-lost');
        activePointer = null;
    };

    const handleClick = (event) => {
        if (Date.now() > suppressClickUntil) return;
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
    };

    const preventNativeDrag = (event) => event.preventDefault();

    row.addEventListener('pointerdown', handlePointerDown);
    row.addEventListener('pointermove', handlePointerMove);
    row.addEventListener('pointerup', handlePointerUp);
    row.addEventListener('pointercancel', handlePointerCancel);
    row.addEventListener('lostpointercapture', handleLostPointerCapture);
    row.addEventListener('dragstart', preventNativeDrag);
    row.addEventListener('click', handleClick, true);

    return () => {
        row.removeEventListener('pointerdown', handlePointerDown);
        row.removeEventListener('pointermove', handlePointerMove);
        row.removeEventListener('pointerup', handlePointerUp);
        row.removeEventListener('pointercancel', handlePointerCancel);
        row.removeEventListener('lostpointercapture', handleLostPointerCapture);
        row.removeEventListener('dragstart', preventNativeDrag);
        row.removeEventListener('click', handleClick, true);
        resetDragVisual(false);
        activePointer = null;
    };
}
