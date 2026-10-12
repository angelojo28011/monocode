import { describe, expect, it } from "vitest";
import {
  clampRightPanelWidth,
  createInitialRightPanelState,
  createRightPanelTab,
  DEFAULT_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  rightPanelReducer,
  SURFACE_DEFINITIONS,
} from "./rightPanel";

describe("rightPanel model & reducer", () => {
  it("completes an explicit redirect returning to its departure after target loading", () => {
    const a = "https://example.com/a", r = "https://example.com/redirect";
    const tab = createRightPanelTab("browser", a);
    let state = { ...createInitialRightPanelState(), tabs: [tab], activeTabId: tab.id };
    state = rightPanelReducer(state, { type: "navigate", tabId: tab.id, url: r });
    const observe = (url: string, loading: boolean) => {
      state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url, kind: "load", loading });
    };
    const requested = state;
    observe(a, false);
    expect(state).toEqual(requested);
    observe(r, true);
    expect(state.tabs[0]).toMatchObject({ url: r, history: [a, r], historyIndex: 1, isLoading: true });
    const loading = state;
    observe(a, true);
    expect(state).toEqual(loading);
    observe(a, false);
    expect(state.tabs[0]).toMatchObject({ url: a, history: [a, a], historyIndex: 1, isLoading: false });
    expect(state.tabs[0].nativePending).toBeUndefined();
  });
  it("redirect/load/title observations preserve native Back and Forward history", () => {
    const first = "http://localhost:5173/first";
    const second = "http://localhost:5173/second";
    const tab = createRightPanelTab("browser", first);
    let state = { ...createInitialRightPanelState(), tabs: [tab], activeTabId: tab.id };
    const observe = (url: string, kind: "navigation" | "load" | "title", loading: boolean | null, title?: string) => {
      state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url, kind, loading, title });
    };
    observe("http://localhost:5173/redirect", "navigation", null);
    observe(second, "load", true);
    observe(second, "title", null, "Second");
    observe(second, "load", false);
    state = rightPanelReducer(state, { type: "go_back", tabId: tab.id });
    // Delayed departure callbacks must not branch or destroy the forward document.
    observe(second, "title", null, "Late second title");
    observe(second, "load", false);
    observe(first, "navigation", null);
    observe(first, "load", true);
    observe(first, "load", false);
    observe(first, "title", null, "First");
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: first, kind: "load", loading: false, canGoForward: true });
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: second, kind: "title", loading: null, title: "Stale native availability", canGoForward: false });
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: second, kind: "load", loading: false, canGoForward: false });
    observe(second, "title", null, "Departed title after completion");
    observe(second, "load", false);
    expect(state.tabs[0].history).toEqual([first, second]);
    expect(state.tabs[0].historyIndex).toBe(0);
    expect(state.tabs[0].title).toBe("First");
    expect(state.tabs[0].nativeCanGoForward).toBe(true);
    state = rightPanelReducer(state, { type: "go_forward", tabId: tab.id });
    observe(first, "title", null, "Late first title");
    observe(second, "navigation", null);
    observe(second, "load", true);
    observe(second, "load", false);
    expect(state.tabs[0].history).toEqual([first, second]);
    expect(state.tabs[0].historyIndex).toBe(1);
    expect(state.tabs[0].navigationToken).toBeUndefined();
    expect(state.tabs[0].reloadToken).toBe(0);
  });
  it("explicit navigation replaces its provisional redirect entry and alone branches history", () => {
    const tab = createRightPanelTab("browser", "https://example.com/first");
    let state = { ...createInitialRightPanelState(), tabs: [tab] };
    state = rightPanelReducer(state, { type: "navigate", tabId: tab.id, url: "https://example.com/redirect" });
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: "https://example.com/second", kind: "load", loading: false });
    expect(state.tabs[0].history).toEqual(["https://example.com/first", "https://example.com/second"]);
    state = rightPanelReducer(state, { type: "go_back", tabId: tab.id });
    state = rightPanelReducer(state, { type: "navigate", tabId: tab.id, url: "https://example.com/third" });
    expect(state.tabs[0].history).toEqual(["https://example.com/first", "https://example.com/third"]);
    expect(state.tabs[0].navigationToken).toBe(2);
  });

  it("observed same-document fragment traversal preserves both history directions without load callbacks", () => {
    const base = "https://example.com/page";
    const tab = createRightPanelTab("browser", base);
    tab.nativeCanGoBack = false;
    tab.nativeCanGoForward = false;
    let state = { ...createInitialRightPanelState(), tabs: [tab] };
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: `${base}#section`, kind: "navigation", loading: null });
    expect(state.tabs[0].history).toEqual([base, `${base}#section`]);
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: `${base}#section`, kind: "title", title: "Section", canGoBack: true, canGoForward: false });
    state = rightPanelReducer(state, { type: "go_back", tabId: tab.id });
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: base, kind: "navigation", loading: null });
    expect(state.tabs[0].historyIndex).toBe(0);
    expect(state.tabs[0].nativeCanGoForward).toBeUndefined();
    expect(state.tabs[0].history).toEqual([base, `${base}#section`]);
    state = rightPanelReducer(state, { type: "go_forward", tabId: tab.id });
    state = rightPanelReducer(state, { type: "native_observation", tabId: tab.id, url: `${base}#section`, kind: "navigation", loading: null });
    expect(state.tabs[0].historyIndex).toBe(1);
    expect(state.tabs[0].navigationToken).toBeUndefined();
  });

  it("native observations update exact hidden tabs without becoming navigation requests", () => {
    const first = createRightPanelTab("browser", "https://example.com");
    const second = createRightPanelTab("device", "https://device.example.com");
    const state = { ...createInitialRightPanelState(), tabs: [first, second], activeTabId: second.id };
    const next = rightPanelReducer(state, { type: "native_observation", tabId: first.id, url: "https://redirect.example.com", title: "Redirected", loading: false });
    expect(next.tabs[0]).toMatchObject({ url: "https://redirect.example.com", title: "Redirected", nativeObserved: true, isLoading: false, reloadToken: 0 });
    expect(next.tabs[0].navigationToken).toBeUndefined();
    expect(next.tabs[1]).toEqual(second);
    expect(next.activeTabId).toBe(second.id);
    const requested = rightPanelReducer(next, { type: "navigate", tabId: first.id, url: "https://requested.example.com" });
    expect(requested.tabs[0].navigationToken).toBe(1);
    const back = rightPanelReducer(requested, { type: "go_back", tabId: first.id });
    const observed = rightPanelReducer(back, { type: "native_observation", tabId: first.id, url: back.tabs[0].url!, loading: false });
    expect(observed.tabs[0].navigationToken).toBe(1);
    expect(observed.tabs[0].history).toEqual(back.tabs[0].history);
    expect(observed.tabs[0].historyIndex).toBe(back.tabs[0].historyIndex);
  });
  it("repeated native observations update titles without duplicating URL history", () => {
    const tab = createRightPanelTab("browser", "https://example.com");
    const state = { ...createInitialRightPanelState(), tabs: [tab], activeTabId: tab.id };
    const next = rightPanelReducer(state, { type: "navigate", tabId: tab.id, url: tab.url!, title: "Example" });
    expect(next.tabs[0].history).toEqual(tab.history);
    expect(next.tabs[0].historyIndex).toBe(0);
    expect(next.tabs[0].title).toBe("Example");
    expect(next.tabs[0].reloadToken).toBe(0);
  });
  it("initializes with closed dock state and empty tabs", () => {
    const state = createInitialRightPanelState();
    expect(state.isOpen).toBe(false);
    expect(state.mode).toBe("dock");
    expect(state.width).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(state.activeTabId).toBeNull();
    expect(state.tabs).toEqual([]);
  });

  it("contains all 7 required surface definitions with shortcuts", () => {
    const keys = SURFACE_DEFINITIONS.map((s) => s.shortcutKey);
    expect(keys).toEqual(["B", "T", "F", "D", "P", "L", "M"]);
  });

  it("clamps width within bounds", () => {
    expect(clampRightPanelWidth(100)).toBe(MIN_RIGHT_PANEL_WIDTH);
    expect(clampRightPanelWidth(2500)).toBe(MAX_RIGHT_PANEL_WIDTH);
    expect(clampRightPanelWidth(600)).toBe(600);
    expect(clampRightPanelWidth(NaN)).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
  });

  it("toggles open and preserves empty tabs state to show surface picker", () => {
    const initial = createInitialRightPanelState();
    const opened = rightPanelReducer(initial, { type: "toggle_open" });

    expect(opened.isOpen).toBe(true);
    expect(opened.tabs.length).toBe(0);
    expect(opened.activeTabId).toBeNull();

    const closed = rightPanelReducer(opened, { type: "toggle_open" });
    expect(closed.isOpen).toBe(false);
  });

  it("replaces tab surface in-place for picker tabs", () => {
    let state = createInitialRightPanelState();
    state = rightPanelReducer(state, {
      type: "open_surface",
      surfaceType: "picker",
    });
    const tabId = state.activeTabId!;
    expect(state.tabs[0].type).toBe("picker");

    state = rightPanelReducer(state, {
      type: "replace_tab_surface",
      tabId,
      surfaceType: "terminal",
    });
    expect(state.tabs[0].type).toBe("terminal");
    expect(state.tabs[0].title).toBe("Terminal");
  });

  it("updates tab title with set_tab_title", () => {
    let state = createInitialRightPanelState();
    state = rightPanelReducer(state, {
      type: "open_surface",
      surfaceType: "terminal",
    });
    const tabId = state.activeTabId!;

    state = rightPanelReducer(state, {
      type: "set_tab_title",
      tabId,
      title: "bash ~",
    });
    expect(state.tabs[0].title).toBe("bash ~");
  });

  it("switches modes between dock and fullscreen", () => {
    let state = createInitialRightPanelState();
    expect(state.mode).toBe("dock");

    state = rightPanelReducer(state, { type: "toggle_mode" });
    expect(state.mode).toBe("fullscreen");

    state = rightPanelReducer(state, { type: "toggle_mode" });
    expect(state.mode).toBe("dock");

    state = rightPanelReducer(state, { type: "set_mode", mode: "fullscreen" });
    expect(state.mode).toBe("fullscreen");
  });

  it("opens a new surface and sets it active", () => {
    let state = createInitialRightPanelState();
    state = rightPanelReducer(state, {
      type: "open_surface",
      surfaceType: "terminal",
      title: "Terminal 1",
    });

    expect(state.isOpen).toBe(true);
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].type).toBe("terminal");
    expect(state.tabs[0].title).toBe("Terminal 1");
    expect(state.activeTabId).toBe(state.tabs[0].id);

    state = rightPanelReducer(state, {
      type: "open_surface",
      surfaceType: "diff",
    });
    expect(state.tabs.length).toBe(2);
    expect(state.tabs[1].type).toBe("diff");
    expect(state.activeTabId).toBe(state.tabs[1].id);
  });

  it("handles web navigation, back, forward and reload", () => {
    let state = createInitialRightPanelState();
    state = rightPanelReducer(state, {
      type: "open_surface",
      surfaceType: "browser",
    });
    const tabId = state.activeTabId!;

    state = rightPanelReducer(state, {
      type: "navigate",
      tabId,
      url: "http://localhost:3000",
      title: "Job Tracker",
    });

    expect(state.tabs[0].url).toBe("http://localhost:3000");
    expect(state.tabs[0].title).toBe("Job Tracker");
    expect(state.tabs[0].history).toEqual(["http://localhost:3000"]);
    expect(state.tabs[0].historyIndex).toBe(0);

    state = rightPanelReducer(state, {
      type: "navigate",
      tabId,
      url: "http://localhost:3000/dashboard",
      title: "Dashboard",
    });

    expect(state.tabs[0].url).toBe("http://localhost:3000/dashboard");
    expect(state.tabs[0].historyIndex).toBe(1);

    // Go back
    state = rightPanelReducer(state, { type: "go_back", tabId });
    expect(state.tabs[0].url).toBe("http://localhost:3000");
    expect(state.tabs[0].historyIndex).toBe(0);

    // Go forward
    state = rightPanelReducer(state, { type: "go_forward", tabId });
    expect(state.tabs[0].url).toBe("http://localhost:3000/dashboard");
    expect(state.tabs[0].historyIndex).toBe(1);

    // Reload
    expect(state.tabs[0].reloadToken).toBe(0);
    state = rightPanelReducer(state, { type: "reload_tab", tabId });
    expect(state.tabs[0].reloadToken).toBe(1);
  });

  it("closes tabs and adjusts active selection or closes panel when last tab is closed", () => {
    let state = createInitialRightPanelState();
    state = rightPanelReducer(state, { type: "open_surface", surfaceType: "browser" });
    state = rightPanelReducer(state, { type: "open_surface", surfaceType: "terminal" });

    const [tab1, tab2] = state.tabs;
    expect(state.activeTabId).toBe(tab2.id);

    // Close active tab2 -> focus should fallback to tab1
    state = rightPanelReducer(state, { type: "close_tab", tabId: tab2.id });
    expect(state.tabs.length).toBe(1);
    expect(state.activeTabId).toBe(tab1.id);
    expect(state.isOpen).toBe(true);

    // Close remaining tab1 -> panel closes
    state = rightPanelReducer(state, { type: "close_tab", tabId: tab1.id });
    expect(state.tabs.length).toBe(0);
    expect(state.activeTabId).toBeNull();
    expect(state.isOpen).toBe(false);
  });
});
