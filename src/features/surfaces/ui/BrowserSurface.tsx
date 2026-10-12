import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserHomeView } from "./BrowserHomeView";
import type { RightPanelTab, SurfaceType } from "../model/rightPanel";
import { syncBrowserBounds, hideBrowser, reloadBrowser, navigateBrowser, listenBrowserNavigation, goBackBrowser, goForwardBrowser } from "../../../platform/tauri/browser";
import { loadUiScale, UI_SCALE_CHANGE_EVENT } from "../../settings/model/uiScale";

interface Props {
  tab: RightPanelTab;
  onNavigate: (tabId: string, url: string, title?: string) => void;
  onGoBack: (tabId: string) => void;
  onGoForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onOpenSurface: (surfaceType: SurfaceType) => void;
  onNativeNavigate?: (tabId: string, url: string, loading: boolean, title?: string) => void;
  /** Native child views sit above DOM overlays: hide while an owned overlay is open. */
  blocked?: boolean;
  clipRef?: RefObject<HTMLElement | null>;
  geometryKey?: string;
  isDeviceMode?: boolean;
  onToggleDeviceMode?: () => void;
  detectedPort?: number;
}
export function BrowserSurface({ tab, onNavigate, onGoBack, onGoForward, onReload, onOpenSurface, onNativeNavigate, blocked = false, clipRef, geometryKey, isDeviceMode, onToggleDeviceMode, detectedPort }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const observedUrl = useRef<string | undefined>(undefined);
  const pendingNavigation = useRef<Promise<void> | undefined>(undefined);
  const subscriptionReady = useRef<Promise<void>>(Promise.resolve());
  const issuedRequest = useRef<number | undefined>(undefined);
  const observedTab = useRef(tab.id);
  if (observedTab.current !== tab.id) { observedTab.current = tab.id; observedUrl.current = undefined; issuedRequest.current = undefined; }
  const latest = useRef({ tab, onNavigate, onNativeNavigate });
  latest.current = { tab, onNavigate, onNativeNavigate };
  const [tabError, setTabError] = useState({ tabId: tab.id, message: "" });
  const error = tabError.tabId === tab.id ? tabError.message : "";
  const setError = useCallback((message: string) => setTabError({ tabId: tab.id, message }), [tab.id]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const report = useCallback((err: unknown) => {
    if (latest.current.tab.id !== tab.id) return;
    setLoading(false); setError(String(err)); void hideBrowser(tab.id).catch(console.error);
  }, [tab.id, setError]);
  const updateBounds = useCallback(async () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || blocked || !tab.url) { await hideBrowser(tab.id); return; }
    const clip = clipRef?.current?.getBoundingClientRect();
    const left = Math.max(rect.left, clip?.left ?? 0, 0);
    const top = Math.max(rect.top, clip?.top ?? 0, 0);
    const right = Math.min(rect.right, clip?.right ?? window.innerWidth, window.innerWidth);
    const bottom = Math.min(rect.bottom, clip?.bottom ?? window.innerHeight, window.innerHeight);
    // Native page zoom changes CSS viewport units; CSS zoom fallback already affects rects.
    const zoom = document.documentElement.style.zoom ? 1 : loadUiScale();
    await syncBrowserBounds({ tabId: tab.id, x: left * zoom, y: top * zoom, width: Math.max(0, right - left) * zoom, height: Math.max(0, bottom - top) * zoom, visible: !error && right > left && bottom > top });
  }, [tab.id, tab.url, blocked, clipRef, error]);
  const boundsRef = useRef(updateBounds);
  boundsRef.current = updateBounds;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    pendingNavigation.current = undefined;
    subscriptionReady.current = listenBrowserNavigation((event) => {
      if (disposed) return;
      const current = latest.current;
      if (event.tabId !== tab.id || current.tab.id !== tab.id) return;
      if (event.kind === "title" && event.url !== current.tab.url) return;
      observedUrl.current = event.url;
      if (event.loading !== null) setLoading(event.loading);
      if (current.onNativeNavigate) current.onNativeNavigate(current.tab.id, event.url, event.loading ?? loadingRef.current, event.title ?? undefined);
      else if (event.url !== current.tab.url || event.title) current.onNavigate(current.tab.id, event.url, event.title ?? undefined);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    void subscriptionReady.current.catch(report);
    return () => { disposed = true; unlisten?.(); observedUrl.current = undefined; issuedRequest.current = undefined; };
  }, [tab.id, report]);

  useEffect(() => {
    let disposed = false;
    if (!tab.url) { observedUrl.current = undefined; void hideBrowser(tab.id).catch(report); return; }
    const token = tab.navigationToken ?? 0;
    const restoring = issuedRequest.current === undefined;
    const requested = !restoring && issuedRequest.current !== token;
    issuedRequest.current = token;
    if (requested || (!tab.nativeObserved && observedUrl.current !== tab.url)) {
      observedUrl.current = tab.url;
      setError("");
      setLoading(true);
      const url = tab.url;
      pendingNavigation.current = subscriptionReady.current.then(() => {
        // A superseded mount must not create a removed tab after its listener resolves.
        if (!disposed) return navigateBrowser(url, tab.id, restoring);
      });
    }
    // Reuse pending creation through effect replay; geometry never owns navigation.
    const pending = pendingNavigation.current;
    if (pending) void pending.then(async () => {
      if (!disposed) await boundsRef.current();
    }).catch((err) => { if (!disposed) report(err); });
    return () => { disposed = true; };
  }, [tab.id, tab.url, tab.navigationToken, tab.nativeObserved, report]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; void boundsRef.current().catch(report); });
    };
    // Occlusion transitions are immediate; only resize/scroll notifications are coalesced.
    void boundsRef.current().catch(report);
    const observer = new ResizeObserver(schedule);
    if (containerRef.current) observer.observe(containerRef.current);
    if (clipRef?.current) observer.observe(clipRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener(UI_SCALE_CHANGE_EVENT, schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener(UI_SCALE_CHANGE_EVENT, schedule);
      void hideBrowser(tab.id).catch(console.error);
    };
  }, [tab.id, tab.url, blocked, clipRef, geometryKey, error, report]);

  const toolbar = <BrowserToolbar url={tab.url} canGoBack={tab.nativeCanGoBack ?? tab.historyIndex > 0} canGoForward={tab.nativeCanGoForward ?? tab.historyIndex < tab.history.length - 1}
    onGoBack={() => {
      observedUrl.current = tab.history[tab.historyIndex - 1];
      onGoBack(tab.id);
      void goBackBrowser(tab.id).catch(report);
    }} onGoForward={() => {
      observedUrl.current = tab.history[tab.historyIndex + 1];
      onGoForward(tab.id);
      void goForwardBrowser(tab.id).catch(report);
    }}
    onReload={() => { onReload(tab.id); if (tab.url) { setError(""); void reloadBrowser(tab.id).catch(report); } }}
    onNavigate={(url) => onNavigate(tab.id, url)} isDeviceMode={isDeviceMode} onToggleDeviceMode={onToggleDeviceMode} />;
  return <div data-testid="browser-surface" className="relative flex h-full w-full flex-col bg-transparent overflow-hidden select-none">
    {toolbar}
    {(tab.isLoading ?? loading) && <div role="status" className="text-xs text-content/60 px-3">Cargando…</div>}
    {error && <div role="alert" className="text-xs text-content px-3">No se pudo abrir el navegador: {error}</div>}
    {!tab.url ? <div className="flex-1 overflow-y-auto"><BrowserHomeView onOpenSurface={onOpenSurface} onNavigate={(url, title) => onNavigate(tab.id, url, title)} detectedPort={detectedPort} /></div>
      : <div ref={containerRef} className="relative flex-1 w-full min-h-0 bg-transparent overflow-hidden" />}
  </div>;
}
