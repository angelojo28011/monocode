// @vitest-environment happy-dom
// The repository runner discovers .test.ts only; include component regressions here.
import "./RightPanelContainer.test";
import "./OpenSurfaceView.test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { RightPanelContainer } from "./RightPanelContainer";
import { canHandleRightPanelShortcut } from "./rightPanelShortcut";
import { createInitialRightPanelState } from "../model/rightPanel";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("hidden or inactive dialogs do not own browser shortcuts", () => {
  const host = document.createElement("div");
  host.innerHTML = '<div role="dialog" hidden></div><div data-model-picker aria-hidden="true"></div><dialog></dialog><div role="dialog" style="display:none"></div>';
  document.body.append(host);
  try { expect(canHandleRightPanelShortcut(new KeyboardEvent("keydown", { key: "b" }))).toBe(true); }
  finally { host.remove(); }
});
const contexts = [
  '<input>', '<textarea></textarea>', '<select><option>b</option></select>',
  '<div contenteditable="true"><span></span></div>', '<div contenteditable=""><span></span></div>',
  '<div contenteditable="plaintext-only"><span></span></div>',
  '<div class="xterm"><span></span></div>', '<div class="cm-editor"><span></span></div>',
  '<div role="textbox"><span></span></div>',
  '<div role="dialog"><button></button></div>', '<div data-popover-side="bottom"><button></button></div>',
  '<div data-model-picker><button></button></div>',
];
function checkRejected(html: string, init: KeyboardEventInit = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const dispatch = vi.fn();
  act(() => root.render(createElement(RightPanelContainer, { state: { ...createInitialRightPanelState(), isOpen: true }, dispatch })));
  const context = document.createElement("div"); context.innerHTML = html; document.body.append(context);
  const target = context.querySelector("span,button,option,input,textarea") ?? context;
  const event = new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true, ...init });
  if (html.includes("onkeydown")) target.addEventListener("keydown", e => e.preventDefault());
  try {
    act(() => target.dispatchEvent(event));
    expect(dispatch).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(html.includes("onkeydown"));
  } finally {
    act(() => root.unmount()); host.remove(); context.remove();
  }
}
it.each(contexts)("B respects input/overlay ownership: %s", html => checkRejected(html));
it.each(["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing"])("B ignores %s", key => checkRejected("<button></button>", { [key]: true }));
it.each(['<div role="dialog"></div>', '<div data-popover-side="bottom"></div>', '<div data-model-picker></div>'])("overlay owns B while focus is outside: %s", html => checkRejected(html));
it("B respects already consumed events", () => checkRejected('<button onkeydown="event.preventDefault()"></button>'));
