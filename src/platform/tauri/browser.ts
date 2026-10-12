import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

function getActiveWindowLabel(): string {
  try { return getCurrentWindow().label; } catch { return "main"; }
}
export interface BrowserBoundsOptions {
  windowLabel?: string;
  tabId?: string;
  x: number; y: number; width: number; height: number; visible: boolean;
  /** Unsupported: supplied URLs are rejected; use navigateBrowser. */
  url?: string;
}
export interface BrowserNavigationEvent { windowLabel: string; tabId: string; url: string; loading: boolean | null; title?: string | null; kind?: "navigation" | "load" | "title" | "restore"; canGoBack?: boolean; canGoForward?: boolean }
const observations = new Map<string, BrowserNavigationEvent>();
const traversalDepartures = new Map<string, string>();
const observers = new Set<(event: BrowserNavigationEvent) => void>();
let nativeSubscription: Promise<void> | undefined;

/** The native listener/cache lives with the shell Webview, including while the panel is unmounted. */
export async function listenBrowserNavigation(callback: (event: BrowserNavigationEvent) => void): Promise<() => void> {
  const label = getActiveWindowLabel();
  if (!nativeSubscription) {
    nativeSubscription = listen<BrowserNavigationEvent>("browser-navigation", ({ payload }) => {
      if (payload.windowLabel !== label) return;
      const previous = observations.get(payload.tabId);
      const kind = payload.kind ?? (payload.loading !== null ? "load" : payload.title ? "title" : "navigation");
      // A delayed title from a departed document cannot replace the cached native URL.
      if (kind === "title" && previous && payload.url !== previous.url) return;
      if (kind === "load" && payload.url === traversalDepartures.get(payload.tabId) && previous?.url !== payload.url) return;
      const event = { ...payload, kind,
        loading: payload.loading ?? previous?.loading ?? null,
        title: payload.title ?? (previous?.url === payload.url ? previous.title : undefined),
      };
      observations.set(payload.tabId, event);
      for (const observer of observers) observer(event);
    }).then(() => {}).catch(error => { nativeSubscription = undefined; throw error; });
  }
  await nativeSubscription;
  observers.add(callback);
  for (const event of observations.values()) callback({ ...event, kind: "restore" });
  return () => { observers.delete(callback); };
}
export function validateBrowserUrl(url: string): string {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  return url;
}
export function normalizeBrowserUrl(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return validateBrowserUrl(trimmed);
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) return validateBrowserUrl(`http://${trimmed}`);
  if (!/\s/.test(trimmed) && /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(trimmed)) return validateBrowserUrl(`https://${trimmed}`);
  // Search operators are query text, never protocols passed to the native WebView.
  const searchOperator = /^(site|intitle|allintitle|inurl|allinurl|intext|allintext|filetype|ext|related|cache|before|after|source|define):/i.test(trimmed);
  const nonWebUrl = /^(javascript|file|data|about|mailto|tel|blob):/i.test(trimmed) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (nonWebUrl && !searchOperator) throw new Error("Only HTTP and HTTPS URLs are supported");
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
export async function syncBrowserBounds(options: BrowserBoundsOptions): Promise<void> {
  if (options.url !== undefined) throw new Error("Browser bounds do not support url; use browser_navigate");
  if (![options.x, options.y, options.width, options.height].every(Number.isFinite) || options.width < 0 || options.height < 0) throw new Error("Invalid browser bounds");
  await invoke("browser_sync_bounds", {
    windowLabel: options.windowLabel || getActiveWindowLabel(),
    ...(options.tabId ? { tabId: options.tabId } : {}),
    x: options.x, y: options.y, width: options.width, height: options.height, visible: options.visible,
  });
}
const pendingNavigations = new Map<string, Promise<void>>();
export async function navigateBrowser(url: string, tabId?: string, restore?: boolean): Promise<void> {
  const windowLabel = getActiveWindowLabel();
  const key = `${windowLabel}:${tabId ?? "legacy"}`;
  const target = validateBrowserUrl(url);
  if (tabId && !restore) traversalDepartures.delete(tabId);
  const pending = invoke<void>("browser_navigate", { windowLabel, ...(tabId ? { tabId } : {}), ...(restore !== undefined ? { restore } : {}), url: target });
  pendingNavigations.set(key, pending);
  try { await pending; }
  finally { if (pendingNavigations.get(key) === pending) pendingNavigations.delete(key); }
}
const command = async (name: string, tabId?: string): Promise<void> => {
  await invoke(name, { windowLabel: getActiveWindowLabel(), ...(tabId ? { tabId } : {}) });
};
export const hideBrowser = (tabId?: string) => command("browser_hide", tabId);
export const showBrowser = (tabId?: string) => command("browser_show", tabId);
export const reloadBrowser = (tabId?: string) => command("browser_reload", tabId);
function traverseBrowser(name: string, tabId?: string): Promise<void> {
  const departure = tabId ? observations.get(tabId)?.url : undefined;
  if (tabId && departure) traversalDepartures.set(tabId, departure);
  return command(name, tabId);
}
export const goBackBrowser = (tabId?: string) => traverseBrowser("browser_go_back", tabId);
export const goForwardBrowser = (tabId?: string) => traverseBrowser("browser_go_forward", tabId);
export async function closeBrowser(tabId?: string): Promise<void> {
  const key = `${getActiveWindowLabel()}:${tabId ?? "legacy"}`;
  // Removal must close even a child whose lazy creation is still in flight.
  await pendingNavigations.get(key)?.catch(() => {});
  await command("browser_close", tabId);
  if (tabId) { observations.delete(tabId); traversalDepartures.delete(tabId); }
  else { observations.clear(); traversalDepartures.clear(); }
}
