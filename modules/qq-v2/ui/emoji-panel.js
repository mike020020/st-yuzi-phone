function asFunction(value) {
    return typeof value === 'function' ? value : () => false;
}

/**
 * Owns only the temporary-layer close policy for the emoji panel. Rendering and
 * focus remain with the QQ App, so closing cannot alter the composer draft.
 */
export function createEmojiPanelTemporaryLayerController({
    isOpen = () => false,
    close = () => {},
    isPanelTarget = () => false,
    isToggleTarget = () => false,
} = {}) {
    const readOpen = asFunction(isOpen);
    const closePanel = asFunction(close);
    const insidePanel = asFunction(isPanelTarget);
    const isToggle = asFunction(isToggleTarget);

    const closeIfOpen = () => {
        if (readOpen() !== true) return false;
        closePanel();
        return true;
    };

    return Object.freeze({
        handleKeyDown(event) {
            if (event?.key !== 'Escape' || !closeIfOpen()) return false;
            event.preventDefault?.();
            event.stopPropagation?.();
            return true;
        },
        handlePointerDown(event) {
            if (readOpen() !== true) return false;
            const target = event?.target;
            if (insidePanel(target) || isToggle(target)) return false;
            return closeIfOpen();
        },
        handleNavigation: closeIfOpen,
    });
}
