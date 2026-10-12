import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { listenBrowserNavigation, type BrowserNavigationEvent } from "./browser";
import { syncBrowserBounds, navigateBrowser, hideBrowser, showBrowser, reloadBrowser, goBackBrowser, goForwardBrowser, closeBrowser } from "./browser";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "workspace-2" }) }));

it("geometry updates never carry navigation URLs", async () => {
  await syncBrowserBounds({ x: 1, y: 2, width: 100, height: 200, visible: true });
  expect(invoke).toHaveBeenLastCalledWith("browser_sync_bounds", { windowLabel: "workspace-2", x: 1, y: 2, width: 100, height: 200, visible: true });
});
it("rejects legacy bounds URLs without IPC", async () => {
  vi.mocked(invoke).mockClear();
  await expect(syncBrowserBounds({ x: 1, y: 2, width: 100, height: 200, visible: true, url: "https://example.com" })).rejects.toThrow("Browser bounds do not support url; use browser_navigate");
  expect(invoke).not.toHaveBeenCalled();
});
it("searches ordinary colon-containing queries", () => {
  const query = "TypeError: Cannot read properties of undefined";
  expect(normalizeBrowserUrl(query)).toBe(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
});
it.each(["TypeError:Cannot read properties of undefined", "TypeError:Cannot", "Error:404"])("searches colon-adjacent query text: %s", query => {
  expect(normalizeBrowserUrl(query)).toBe(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
});
it("navigation is scoped and propagates command failures", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("navigation failed"));
  await expect(navigateBrowser("https://example.com")).rejects.toThrow("navigation failed");
  expect(invoke).toHaveBeenLastCalledWith("browser_navigate", { windowLabel: "workspace-2", url: "https://example.com" });
});
it("window observation survives panel unsubscribe and replays hidden redirects on reopening", async () => {
  const first = vi.fn();
  const stop = await listenBrowserNavigation(first);
  const nativeCallback = vi.mocked(listen).mock.calls[0][1];
  const initial: BrowserNavigationEvent = { windowLabel: "workspace-2", tabId: "cached-hidden", url: "https://example.com", loading: false, title: "Initial" };
  nativeCallback({ event: "browser-navigation", id: 1, payload: initial });
  stop();
  nativeCallback({ event: "browser-navigation", id: 2, payload: { ...initial, url: "https://redirect.example.com", title: "Redirected" } });
  expect(first).toHaveBeenCalledTimes(1);
  const reopened = vi.fn();
  const stopReopened = await listenBrowserNavigation(reopened);
  expect(reopened).toHaveBeenCalledExactlyOnceWith({ ...initial, url: "https://redirect.example.com", title: "Redirected", kind: "restore" });
  expect(listen).toHaveBeenCalledTimes(1);
  stopReopened();
});
it("late departure titles and load completion cannot poison cached traversal state", async () => {
  const observer = vi.fn();
  const stop = await listenBrowserNavigation(observer);
  const nativeCallback = vi.mocked(listen).mock.calls[0][1];
  const event: BrowserNavigationEvent = { windowLabel: "workspace-2", tabId: "traversal-cache", url: "https://example.com/second", kind: "load", loading: false, title: "Second" };
  nativeCallback({ event: "browser-navigation", id: 1, payload: event });
  await goBackBrowser(event.tabId);
  nativeCallback({ event: "browser-navigation", id: 2, payload: { ...event, url: "https://example.com/first", title: "First" } });
  observer.mockClear();
  nativeCallback({ event: "browser-navigation", id: 3, payload: { ...event, kind: "title", loading: null } });
  nativeCallback({ event: "browser-navigation", id: 4, payload: event });
  expect(observer).not.toHaveBeenCalled();
  stop();
  const reopened = vi.fn();
  const stopReopened = await listenBrowserNavigation(reopened);
  expect(reopened).toHaveBeenCalledWith({ ...event, url: "https://example.com/first", title: "First", kind: "restore" });
  stopReopened();
  await closeBrowser(event.tabId);
});
it("restore IPC preserves the existing tab document rather than requesting fresh navigation", async () => {
  await navigateBrowser("https://stale.example.com", "restored", true);
  expect(invoke).toHaveBeenLastCalledWith("browser_navigate", { windowLabel: "workspace-2", tabId: "restored", restore: true, url: "https://stale.example.com" });
});
it("tab removal waits for lazy native creation then closes only that identity", async () => {
  let finishCreation!: () => void;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finishCreation = resolve; }));
  const navigating = navigateBrowser("https://example.com", "removed");
  const closing = closeBrowser("removed");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_navigate", { windowLabel: "workspace-2", tabId: "removed", url: "https://example.com" });
  finishCreation();
  await navigating; await closing;
  expect(invoke).toHaveBeenLastCalledWith("browser_close", { windowLabel: "workspace-2", tabId: "removed" });
});
it("keeps existing command names and scopes every browser operation", async () => {
  for (const [operation, name] of [[hideBrowser, "hide"], [showBrowser, "show"], [reloadBrowser, "reload"], [goBackBrowser, "go_back"], [goForwardBrowser, "go_forward"], [closeBrowser, "close"]] as const) {
    await operation();
    expect(invoke).toHaveBeenLastCalledWith(`browser_${name}`, { windowLabel: "workspace-2" });
  }
});
it("invalid URLs and bounds never invoke native commands", async () => {
  vi.mocked(invoke).mockClear();
  await expect(navigateBrowser("file:///tmp/test")).rejects.toThrow();
  await expect(syncBrowserBounds({ x: NaN, y: 0, width: 100, height: 100, visible: true })).rejects.toThrow("Invalid browser bounds");
  await expect(syncBrowserBounds({ x: 0, y: 0, width: -1, height: 100, visible: true })).rejects.toThrow("Invalid browser bounds");
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects non-web schemes rather than converting them to searches", () => {
  expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow();
  expect(() => normalizeBrowserUrl("file:///tmp/test")).toThrow();
  expect(() => normalizeBrowserUrl("javascript: alert(1)")).toThrow();
  expect(() => normalizeBrowserUrl("ftp://example.com")).toThrow();
});
import { normalizeBrowserUrl } from "./browser";

describe("normalizeBrowserUrl", () => {
  it("returns empty string when input is empty", () => {
    expect(normalizeBrowserUrl("")).toBe("");
    expect(normalizeBrowserUrl("   ")).toBe("");
  });

  it("preserves valid http and https URLs", () => {
    expect(normalizeBrowserUrl("https://google.com")).toBe("https://google.com");
    expect(normalizeBrowserUrl("http://localhost:3000/api")).toBe("http://localhost:3000/api");
  });

  it("prepends http to localhost and 127.0.0.1", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserUrl("localhost:5173/dashboard")).toBe("http://localhost:5173/dashboard");
    expect(normalizeBrowserUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("prepends https to domain names", () => {
    expect(normalizeBrowserUrl("google.com")).toBe("https://google.com");
    expect(normalizeBrowserUrl("github.com/torvalds/linux")).toBe("https://github.com/torvalds/linux");
    expect(normalizeBrowserUrl("vite.dev")).toBe("https://vite.dev");
    expect(normalizeBrowserUrl("example.com:8080/path")).toBe("https://example.com:8080/path");
  });

  it.each(["site:github.com", "intitle:browser", "filetype:pdf", "after:2025-01-01", "inurl:docs"])(
    "supports Google search operators: %s",
    query => {
      expect(normalizeBrowserUrl(query)).toBe(
        `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      );
    },
  );

  it("transforms search terms into Google search URL", () => {
    expect(normalizeBrowserUrl("react router tutorial")).toBe(
      "https://www.google.com/search?q=react%20router%20tutorial",
    );
    expect(normalizeBrowserUrl("como centrar un div")).toBe(
      "https://www.google.com/search?q=como%20centrar%20un%20div",
    );
  });
});
