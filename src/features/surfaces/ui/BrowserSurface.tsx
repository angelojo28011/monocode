import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserHomeView } from "./BrowserHomeView";
import type { RightPanelTab, SurfaceType } from "../model/rightPanel";
import {
  syncBrowserBounds,
  hideBrowser,
  reloadBrowser,
  goBackBrowser,
  goForwardBrowser,
  navigateBrowser,
} from "../../../platform/tauri/browser";

interface Props {
  tab: RightPanelTab;
  onNavigate: (tabId: string, url: string, title?: string) => void;
  onGoBack: (tabId: string) => void;
  onGoForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onOpenSurface: (surfaceType: SurfaceType) => void;
  isDeviceMode?: boolean;
  onToggleDeviceMode?: () => void;
  detectedPort?: number;
}

export function BrowserSurface({
  tab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onOpenSurface,
  isDeviceMode,
  onToggleDeviceMode,
  detectedPort,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);

  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;

  // Sincronizar dimensiones y posición con la Webview nativa
  const updateBounds = useCallback(() => {
    if (!containerRef.current || !tab.url) {
      void hideBrowser();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      void hideBrowser();
      return;
    }

    void syncBrowserBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible: true,
      url: tab.url,
    });
  }, [tab.url]);

  // Observer de redimensionamiento del panel o ventana
  useEffect(() => {
    if (!tab.url) {
      void hideBrowser();
      return;
    }

    updateBounds();

    const element = containerRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(() => {
      updateBounds();
    });

    resizeObserver.observe(element);
    window.addEventListener("resize", updateBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateBounds);
      void hideBrowser();
    };
  }, [tab.url, updateBounds]);

  const handleNavigate = (url: string) => {
    onNavigate(tab.id, url);
    void navigateBrowser(url);
  };

  const handleGoBack = () => {
    onGoBack(tab.id);
    void goBackBrowser();
  };

  const handleGoForward = () => {
    onGoForward(tab.id);
    void goForwardBrowser();
  };

  const handleReload = () => {
    onReload(tab.id);
    void reloadBrowser();
  };

  const handleToggleAnnotate = () => {
    setIsAnnotating((prev) => !prev);
  };

  if (!tab.url) {
    return (
      <div data-testid="browser-surface" className="flex h-full w-full flex-col bg-transparent">
        <BrowserToolbar
          url=""
          canGoBack={false}
          canGoForward={false}
          onGoBack={() => {}}
          onGoForward={() => {}}
          onReload={() => onReload(tab.id)}
          onNavigate={handleNavigate}
          isDeviceMode={isDeviceMode}
          onToggleDeviceMode={onToggleDeviceMode}
        />
        <div className="flex-1 overflow-y-auto">
          <BrowserHomeView
            onOpenSurface={onOpenSurface}
            onNavigate={(url, title) => onNavigate(tab.id, url, title)}
            detectedPort={detectedPort}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="browser-surface"
      className="relative flex h-full w-full flex-col bg-transparent overflow-hidden select-none"
    >
      <BrowserToolbar
        url={tab.url}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onNavigate={handleNavigate}
        onAnnotate={handleToggleAnnotate}
        isAnnotating={isAnnotating}
        isDeviceMode={isDeviceMode}
        onToggleDeviceMode={onToggleDeviceMode}
      />

      {/* Contenedor del lienzo de navegación Webview nativo */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full min-h-0 bg-transparent overflow-hidden"
      >
        {/* Banner de anotación activa cuando el usuario activa 'Anotar' estilo Codex */}
        {isAnnotating ? (
          <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 flex items-center gap-2 rounded-full border border-accent/40 bg-background-base/90 px-4 py-1.5 shadow-lg backdrop-blur-md text-xs text-content">
            <span className="size-2 rounded-full bg-accent animate-pulse" />
            <span className="font-medium">Modo Anotación activo</span>
            <span className="text-content/50">•</span>
            <span className="text-[11px] text-content/70">
              Hacé clic en cualquier elemento de la web para inspeccionar
            </span>
            <button
              type="button"
              onClick={() => setIsAnnotating(false)}
              className="ml-2 text-content/60 hover:text-content font-bold text-xs"
            >
              ✕
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
