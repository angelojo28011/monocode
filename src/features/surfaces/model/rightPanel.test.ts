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
