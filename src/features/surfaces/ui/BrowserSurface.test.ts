// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSurface } from "./BrowserSurface";
import type { RightPanelTab } from "../model/rightPanel";

vi.mock("../../../platform/tauri/browser", () => ({
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
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

  it("renders BrowserToolbar with URL and Anotar button when tab.url is provided", () => {
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
    expect(container.textContent).toContain("Anotar");
  });
});
