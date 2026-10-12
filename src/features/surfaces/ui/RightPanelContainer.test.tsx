// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RightPanelContainer } from "./RightPanelContainer";
import { createInitialRightPanelState, createRightPanelTab, type SurfaceType } from "../model/rightPanel";
import { closeBrowser, hideBrowser } from "../../../platform/tauri/browser";
vi.mock("../../../platform/tauri/browser", () => ({ hideBrowser: vi.fn(async () => {}), closeBrowser: vi.fn(async () => {}), listenBrowserNavigation: vi.fn(async () => () => {}) }));
vi.mock("./BrowserSurface", () => ({ BrowserSurface: () => null }));
vi.mock("./DeviceSurface", () => ({ DeviceSurface: () => null }));
vi.mock("../../terminal/ui/TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./FilesSurface", () => ({ FilesSurface: () => null }));
vi.mock("./DiffSurface", () => ({ DiffSurface: () => null }));
vi.mock("./PrSurface", () => ({ PrSurface: () => null }));
vi.mock("./LinkedPrSurface", () => ({ LinkedPrSurface: () => null }));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => { act(() => root.unmount()); root = createRoot(host); vi.clearAllMocks(); });
function mount(type: SurfaceType, existing = false, open = true) {
  const tab = createRightPanelTab(type);
  const browser = createRightPanelTab("browser");
  const dispatch = vi.fn();
  act(() => root.render(<RightPanelContainer state={{ ...createInitialRightPanelState(), isOpen: open, tabs: existing ? [tab, browser] : [tab], activeTabId: tab.id }} dispatch={dispatch} />));
  return { dispatch, tab, browser };
}
function press(key = "b") { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }); act(() => window.dispatchEvent(event)); return event; }
it.each<SurfaceType>(["browser", "terminal", "files", "diff", "pr", "linked_pr", "device", "picker"])("B activates existing browser from %s without duplicates", type => {
  const { dispatch, browser, tab } = mount(type, true);
  expect(press().defaultPrevented).toBe(true);
  expect(dispatch.mock.calls).toEqual([[{ type: "select_tab", tabId: type === "browser" ? tab.id : browser.id }]]);
});
it.each<SurfaceType>(["terminal", "files", "diff", "pr", "linked_pr", "device"])("B creates browser from %s", type => {
  const { dispatch } = mount(type);
  press(); expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "open_surface", surfaceType: "browser" });
});
it("B replaces picker when no browser exists", () => { const { dispatch, tab } = mount("picker"); press(); expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "replace_tab_surface", tabId: tab.id, surfaceType: "browser" }); });
it("closed and unmounted panels ignore B", () => { const { dispatch } = mount("picker", false, false); expect(press().defaultPrevented).toBe(false); act(() => root.unmount()); root = createRoot(host); press(); expect(dispatch).not.toHaveBeenCalled(); });
it.each<SurfaceType>(["browser", "device"])("does not hide native browser for %s", type => { mount(type); expect(hideBrowser).not.toHaveBeenCalled(); });
it.each<SurfaceType>(["terminal", "files", "diff", "pr", "linked_pr", "picker"])("hides native browser for %s", type => { mount(type); expect(hideBrowser).toHaveBeenCalledOnce(); });
it("hides native browser when closed", () => { mount("device", false, false); expect(hideBrowser).toHaveBeenCalledOnce(); });
it("hides the previous native tab and closes removed native identities", () => {
  const { dispatch, tab } = mount("browser");
  const next = createRightPanelTab("device");
  act(() => root.render(<RightPanelContainer state={{ ...createInitialRightPanelState(), isOpen: true, tabs: [next], activeTabId: next.id }} dispatch={dispatch} />));
  expect(hideBrowser).toHaveBeenCalledWith(tab.id);
  expect(closeBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
});
it("preserves dock/fullscreen and closing controls", () => {
  const { dispatch, tab } = mount("browser");
  act(() => (host.querySelector('[aria-label="Pantalla completa"]') as HTMLButtonElement).click());
  expect(dispatch).toHaveBeenLastCalledWith({ type: "toggle_mode" });
  act(() => root.render(<RightPanelContainer state={{ ...createInitialRightPanelState(), isOpen: true, mode: "fullscreen", tabs: [tab], activeTabId: tab.id }} dispatch={dispatch} />));
  expect(host.querySelector("aside")?.style.width).toBe("");
  expect(hideBrowser).not.toHaveBeenCalled();
  act(() => (host.querySelector('[aria-label="Restaurar a panel derecho"]') as HTMLButtonElement).click());
  expect(dispatch).toHaveBeenLastCalledWith({ type: "toggle_mode" });
  act(() => (host.querySelector('[aria-label="Cerrar Right Panel"]') as HTMLButtonElement).click());
  expect(dispatch).toHaveBeenLastCalledWith({ type: "toggle_open" });
  act(() => (host.querySelector(`[aria-label="Cerrar pestaña ${tab.title}"]`) as HTMLButtonElement).click());
  expect(dispatch).toHaveBeenLastCalledWith({ type: "close_tab", tabId: tab.id });
});
