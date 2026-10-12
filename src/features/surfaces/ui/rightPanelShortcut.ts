const EDITING_CONTEXT = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], .xterm, .cm-editor, .monaco-editor';
export const OVERLAY_CONTEXT = '[role="dialog"], [role="alertdialog"], dialog[open], [data-popover-side], [data-model-picker], [data-model-settings], [popover]:popover-open';

function isVisibleOverlay(element: Element): boolean {
  if (element instanceof HTMLDialogElement && !element.open) return false;
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute("hidden") || ancestor.hasAttribute("inert") || ancestor.getAttribute("aria-hidden") === "true" || ancestor.getAttribute("data-state") === "closed") return false;
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

export function hasVisibleRightPanelOverlay(): boolean {
  return Array.from(document.querySelectorAll(OVERLAY_CONTEXT)).some(isVisibleOverlay);
}

/** Observe only mutations that can change an overlay owner, not terminal/text updates. */
export function observeRightPanelOverlays(callback: (blocked: boolean) => void): () => void {
  const affectsOverlay = (node: Node) => node instanceof Element && (
    node.matches(OVERLAY_CONTEXT) || !!node.closest(OVERLAY_CONTEXT) || !!node.querySelector(OVERLAY_CONTEXT)
  );
  const update = () => callback(hasVisibleRightPanelOverlay());
  const observer = new MutationObserver((records) => {
    if (records.some(record => record.type === "attributes"
      ? affectsOverlay(record.target) || ["role", "open", "popover", "data-popover-side", "data-model-picker", "data-model-settings"].includes(record.attributeName ?? "")
      : [...record.addedNodes, ...record.removedNodes].some(affectsOverlay))) update();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ["role", "hidden", "inert", "aria-hidden", "open", "popover", "data-popover-side", "data-model-picker", "data-model-settings", "data-state", "style", "class"] });
  // Native popover toggles need not mutate their DOM attributes.
  document.addEventListener("toggle", update, true);
  update();
  return () => { observer.disconnect(); document.removeEventListener("toggle", update, true); };
}

/** Bare surface keys must yield to typing and to existing overlay owners. */
export function canHandleRightPanelShortcut(event: KeyboardEvent, allowShift = false): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || (!allowShift && event.shiftKey)) return false;
  const isEditing = (target: EventTarget | null) => target instanceof Element && !!target.closest(EDITING_CONTEXT);
  if (event.composedPath().some(isEditing) || isEditing(document.activeElement)) return false;
  // Popovers can own keys even when focus remains on their trigger.
  return !hasVisibleRightPanelOverlay();
}
