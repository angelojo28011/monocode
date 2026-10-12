// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSurface } from "./BrowserSurface";
import type { RightPanelTab } from "../model/rightPanel";
import { RightPanelContainer } from "./RightPanelContainer";
import { DeviceSurface } from "./DeviceSurface";
import { createInitialRightPanelState, rightPanelReducer } from "../model/rightPanel";
import { navigateBrowser, syncBrowserBounds, listenBrowserNavigation, hideBrowser, goBackBrowser, goForwardBrowser } from "../../../platform/tauri/browser";

vi.mock("../../terminal/ui/TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./FilesSurface", () => ({ FilesSurface: () => null }));
vi.mock("./DiffSurface", () => ({ DiffSurface: () => null }));
vi.mock("./PrSurface", () => ({ PrSurface: () => null }));
vi.mock("./LinkedPrSurface", () => ({ LinkedPrSurface: () => null }));
vi.mock("../../../platform/tauri/browser", () => ({
  closeBrowser: vi.fn(async () => {}),
  listenBrowserNavigation: vi.fn(async () => () => {}),
  syncBrowserBounds: vi.fn(async () => {}),
  hideBrowser: vi.fn(async () => {}),
  showBrowser: vi.fn(async () => {}),
  reloadBrowser: vi.fn(async () => {}),
  goBackBrowser: vi.fn(async () => {}),
  goForwardBrowser: vi.fn(async () => {}),
  navigateBrowser: vi.fn(async () => {}),
  normalizeBrowserUrl: (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/.test(trimmed)) return `https://${trimmed}`;
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  },
}));

describe("BrowserSurface", () => {

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("isolates command errors when selecting an already-observed healthy tab", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 } as DOMRect);
    const tab: RightPanelTab = { id: "failed", type: "browser", title: "Failed", url: "https://failed.example.com", history: [], historyIndex: -1, reloadToken: 0 };
    const props = { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() };
    vi.mocked(navigateBrowser).mockRejectedValueOnce(new Error("native unavailable"));
    await act(async () => { root.render(createElement(BrowserSurface, props)); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("native unavailable");
    vi.mocked(navigateBrowser).mockClear();
    vi.mocked(syncBrowserBounds).mockClear();
    await act(async () => { root.render(createElement(BrowserSurface, { ...props, tab: { ...tab, id: "healthy", nativeObserved: true, isLoading: false } })); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(navigateBrowser).not.toHaveBeenCalled();
    expect(syncBrowserBounds).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: "healthy", visible: true }));
  });

  it("hidden-tab observations survive selection without navigating back to stale URLs", async () => {
    const first: RightPanelTab = { id: "hidden-first", type: "browser", title: "First", url: "https://first.example.com", history: ["https://first.example.com"], historyIndex: 0, reloadToken: 0 };
    const second = { ...first, id: "active-second", title: "Second", url: "https://second.example.com" };
    function Panel() {
      const [state, dispatch] = useReducer(rightPanelReducer, { ...createInitialRightPanelState(), isOpen: true, tabs: [first, second], activeTabId: second.id });
      return createElement(RightPanelContainer, { state, dispatch });
    }
    await act(async () => { root.render(createElement(Panel)); });
    await act(async () => {
      for (const [callback] of vi.mocked(listenBrowserNavigation).mock.calls) callback({ windowLabel: "main", tabId: first.id, url: "https://redirect.example.com", loading: false, title: "Redirected hidden tab" });
    });
    expect(container.textContent).toContain("Redirected hidden tab");
    const title = Array.from(container.querySelectorAll("span")).find(element => element.textContent === "Redirected hidden tab")!;
    vi.mocked(navigateBrowser).mockClear();
    await act(async () => { title.click(); });
    expect(navigateBrowser).not.toHaveBeenCalled();
  });

  it("public Forward stays available after a redirected native visit and Back with late callbacks", async () => {
    const first = "http://localhost:5173/first";
    const second = "http://localhost:5173/second";
    const tab: RightPanelTab = { id: "redirect-history", type: "browser", title: "First", url: first, history: [first], historyIndex: 0, reloadToken: 0, nativeObserved: true };
    function Panel() {
      const [state, dispatch] = useReducer(rightPanelReducer, { ...createInitialRightPanelState(), isOpen: true, tabs: [tab], activeTabId: tab.id });
      return createElement(RightPanelContainer, { state, dispatch });
    }
    await act(async () => { root.render(createElement(Panel)); });
    const emit = async (url: string, kind: "navigation" | "load" | "title", loading: boolean | null, title?: string) => {
      await act(async () => { for (const [callback] of vi.mocked(listenBrowserNavigation).mock.calls) callback({ windowLabel: "main", tabId: tab.id, url, kind, loading, title }); });
    };
    await emit("http://localhost:5173/redirect", "navigation", null);
    await emit(second, "load", true);
    await emit(second, "load", false);
    await act(async () => { (container.querySelector('[aria-label="Atrás"]') as HTMLButtonElement).click(); });
    await emit(second, "title", null, "Late second title");
    await emit(second, "load", false);
    await emit(first, "navigation", null);
    await emit(first, "load", true);
    await emit(first, "load", false);
    const forward = container.querySelector('[aria-label="Adelante"]') as HTMLButtonElement;
    expect(forward.disabled).toBe(false);
    await act(async () => { forward.click(); });
    await emit(second, "navigation", null);
    await emit(second, "load", true);
    await emit(second, "load", false);
    expect(goBackBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(goForwardBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(navigateBrowser).not.toHaveBeenCalled();
    expect((container.querySelector('[aria-label="Atrás"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[aria-label="Adelante"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("native availability is authoritative when URL snapshots cannot identify the full document stack", async () => {
    const tab: RightPanelTab = { id: "native-availability", type: "browser", title: "Current", url: "https://example.com/two", history: ["https://example.com/one", "https://example.com/two"], historyIndex: 1, reloadToken: 0, nativeObserved: true, nativeCanGoBack: false, nativeCanGoForward: true };
    await act(async () => { root.render(createElement(BrowserSurface, { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() })); });
    expect((container.querySelector('[aria-label="Atrás"]') as HTMLButtonElement).disabled).toBe(true);
    const forward = container.querySelector('[aria-label="Adelante"]') as HTMLButtonElement;
    expect(forward.disabled).toBe(false);
    await act(async () => { forward.click(); });
    expect(goForwardBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(navigateBrowser).not.toHaveBeenCalled();
  });

  it("Back and Forward use native history once without URL feedback navigation", async () => {
    const tab: RightPanelTab = { id: "history", type: "browser", title: "Second", url: "https://example.com/two", history: ["https://example.com/one", "https://example.com/two"], historyIndex: 1, reloadToken: 0 };
    function Surface() {
      const [state, dispatch] = useReducer(rightPanelReducer, { ...createInitialRightPanelState(), tabs: [tab] });
      return createElement(BrowserSurface, { tab: state.tabs[0], onNavigate: vi.fn(), onGoBack: (tabId) => dispatch({ type: "go_back", tabId }), onGoForward: (tabId) => dispatch({ type: "go_forward", tabId }), onReload: vi.fn(), onOpenSurface: vi.fn() });
    }
    await act(async () => { root.render(createElement(Surface)); });
    vi.mocked(navigateBrowser).mockClear();
    await act(async () => { (container.querySelector('[aria-label="Atrás"]') as HTMLButtonElement).click(); });
    expect(goBackBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(navigateBrowser).not.toHaveBeenCalled();
    await act(async () => { (container.querySelector('[aria-label="Adelante"]') as HTMLButtonElement).click(); });
    expect(goForwardBrowser).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(navigateBrowser).not.toHaveBeenCalled();
  });

  it("device scale change updates native geometry without synthetic resize or scroll", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const scale = container.querySelector("select")?.value === "0.7" ? 0.7 : 0.85;
      return { left: 0, top: 0, right: 200 * scale, bottom: 200 * scale, width: 200 * scale, height: 200 * scale } as DOMRect;
    });
    const tab: RightPanelTab = { id: "scale", type: "device", title: "Device", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    await act(async () => { root.render(createElement(DeviceSurface, { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn(), onSetPreset: vi.fn() })); });
    vi.mocked(syncBrowserBounds).mockClear();
    await act(async () => { const select = container.querySelector("select")!; select.value = "0.7"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(syncBrowserBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: "scale", width: 140, height: 140 }));
  });

  it.each(["browser", "device"] as const)("actual %s hides and restores native bounds as an external overlay opens and closes", async (type) => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 40, right: 220, bottom: 240, width: 200, height: 200 } as DOMRect);
    const tab: RightPanelTab = { id: `overlay-${type}`, type, title: "Example", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    await act(async () => { root.render(createElement(RightPanelContainer, { state: { ...createInitialRightPanelState(), isOpen: true, tabs: [tab], activeTabId: tab.id }, dispatch: vi.fn() })); await vi.runOnlyPendingTimersAsync(); });
    vi.mocked(hideBrowser).mockClear();
    const overlay = document.createElement("div"); overlay.setAttribute("data-model-picker", "");
    await act(async () => { document.body.append(overlay); await vi.runOnlyPendingTimersAsync(); });
    expect(hideBrowser).toHaveBeenCalled();
    vi.mocked(syncBrowserBounds).mockClear();
    await act(async () => { overlay.remove(); await vi.runOnlyPendingTimersAsync(); });
    expect(syncBrowserBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: tab.id, visible: true }));
  });

  it("device native bounds never escape its visible scrolling canvas", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-browser-clip")
        ? { left: 50, top: 100, right: 250, bottom: 300, width: 200, height: 200 } as DOMRect
        : { left: 20, top: 0, right: 420, bottom: 800, width: 400, height: 800 } as DOMRect;
    });
    const tab: RightPanelTab = { id: "clip", type: "device", title: "Device", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    await act(async () => { root.render(createElement(DeviceSurface, { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn(), onSetPreset: vi.fn() })); });
    expect(syncBrowserBounds).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: "clip", x: 50, y: 100, width: 200, height: 200 }));
  });

  it("late native titles and navigations cannot update a different React tab", async () => {
    const onNavigate = vi.fn();
    const first: RightPanelTab = { id: "first", type: "browser", title: "First", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    const props = { tab: first, onNavigate, onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() };
    await act(async () => { root.render(createElement(BrowserSurface, props)); });
    const oldCallback = vi.mocked(listenBrowserNavigation).mock.calls[0][0];
    await act(async () => { root.render(createElement(BrowserSurface, { ...props, tab: { ...first, id: "second", url: "https://second.example.com" } })); });
    const newCallback = vi.mocked(listenBrowserNavigation).mock.calls[1][0];
    act(() => {
      oldCallback({ windowLabel: "main", tabId: "first", url: "https://redirect.example.com", loading: false });
      newCallback({ windowLabel: "main", tabId: "first", url: "https://redirect.example.com", loading: null, title: "Late title" });
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(navigateBrowser).toHaveBeenLastCalledWith("https://second.example.com", "second", true);
  });

  it("tears down late subscriptions without losing the newly selected tab navigation", async () => {
    let finishSubscription!: (stop: () => void) => void;
    const oldStop = vi.fn();
    vi.mocked(listenBrowserNavigation).mockImplementationOnce(() => new Promise(resolve => { finishSubscription = resolve; }));
    const tab: RightPanelTab = { id: "pending-first", type: "browser", title: "First", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    const props = { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() };
    await act(async () => { root.render(createElement(BrowserSurface, props)); });
    expect(navigateBrowser).not.toHaveBeenCalled();
    await act(async () => { root.render(createElement(BrowserSurface, { ...props, tab: { ...tab, id: "pending-second", url: "https://second.example.com" } })); });
    await act(async () => { finishSubscription(oldStop); });
    expect(oldStop).toHaveBeenCalledOnce();
    expect(navigateBrowser).toHaveBeenCalledExactlyOnceWith("https://second.example.com", "pending-second", true);
  });

  it("creates by navigating once and coalesces resize without another navigation", async () => {
    const tab: RightPanelTab = { id: "race", type: "browser", title: "Example", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    await act(async () => { root.render(createElement(BrowserSurface, { tab, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() })); });
    expect(navigateBrowser).toHaveBeenCalledExactlyOnceWith(tab.url, tab.id, true);
    expect(syncBrowserBounds).toHaveBeenCalled();
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(navigateBrowser).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncBrowserBounds).mock.calls.every(([options]) => options.url === undefined)).toBe(true);
  });

  it("native redirects update history callbacks without navigation feedback", async () => {
    const onNavigate = vi.fn();
    const tab: RightPanelTab = { id: "native", type: "browser", title: "Example", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    const props = { tab, onNavigate, onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() };
    await act(async () => { root.render(createElement(BrowserSurface, props)); });
    const callback = vi.mocked(listenBrowserNavigation).mock.calls[0][0];
    act(() => callback({ windowLabel: "main", tabId: tab.id, url: "https://example.com/redirect", loading: false }));
    expect(onNavigate).toHaveBeenCalledWith("native", "https://example.com/redirect", undefined);
    await act(async () => { root.render(createElement(BrowserSurface, { ...props, tab: { ...tab, url: "https://example.com/redirect" } })); });
    expect(navigateBrowser).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Cargando");
  });

  it("hides native content while an overlay blocks the surface and reports command errors", async () => {
    const tab: RightPanelTab = { id: "blocked", type: "browser", title: "Example", url: "https://example.com", history: ["https://example.com"], historyIndex: 0, reloadToken: 0 };
    const props = { tab, blocked: true, onNavigate: vi.fn(), onGoBack: vi.fn(), onGoForward: vi.fn(), onReload: vi.fn(), onOpenSurface: vi.fn() };
    await act(async () => { root.render(createElement(BrowserSurface, props)); });
    expect(hideBrowser).toHaveBeenCalled();
    expect(syncBrowserBounds).not.toHaveBeenCalled();
    vi.mocked(navigateBrowser).mockRejectedValueOnce(new Error("native unavailable"));
    await act(async () => { root.render(createElement(BrowserSurface, { ...props, tab: { ...tab, url: "https://other.example.com" } })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("native unavailable");
  });

  it("renders BrowserHomeView with Google and search bar when tab.url is empty", () => {
    const tab: RightPanelTab = {
      id: "tab-1",
      type: "browser",
      title: "Nueva pestaña",
      url: "",
      history: [],
      historyIndex: -1,
      reloadToken: 0,
    };

    act(() => {
      root.render(
        createElement(BrowserSurface, {
          tab,
          onNavigate: vi.fn(),
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
          onReload: vi.fn(),
          onOpenSurface: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain("Navegador Web");
    expect(container.textContent).toContain("Google");
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("renders BrowserToolbar with URL without pretending annotation is implemented", () => {
    const tab: RightPanelTab = {
      id: "tab-2",
      type: "browser",
      title: "Google",
      url: "https://www.google.com",
      history: ["https://www.google.com"],
      historyIndex: 0,
      reloadToken: 0,
    };

    act(() => {
      root.render(
        createElement(BrowserSurface, {
          tab,
          onNavigate: vi.fn(),
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
          onReload: vi.fn(),
          onOpenSurface: vi.fn(),
        }),
      );
    });

    const toolbarInput = container.querySelector("input");
    expect(toolbarInput).not.toBeNull();
    expect(container.textContent).not.toContain("Anotar");
  });
});
