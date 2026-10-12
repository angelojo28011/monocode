import {
  useState,
  useRef,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ExternalLink,
  File,
  FileDiff,
  GitPullRequest,
  Globe,
  Maximize2,
  PanelRight,
  Plus,
  SmartPhone,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import {
  clampRightPanelWidth,
  type DevicePreset,
  type RightPanelAction,
  type RightPanelState,
  type RightPanelTab,
  type SurfaceType,
} from "../model/rightPanel";
import { BrowserSurface } from "./BrowserSurface";
import { closeBrowser, hideBrowser, listenBrowserNavigation } from "../../../platform/tauri/browser";
import { DeviceSurface } from "./DeviceSurface";
import { OpenSurfaceView } from "./OpenSurfaceView";
import { canHandleRightPanelShortcut, hasVisibleRightPanelOverlay, observeRightPanelOverlays } from "./rightPanelShortcut";
import { TerminalView } from "../../terminal/ui/TerminalView";
import { FilesSurface } from "./FilesSurface";
import { DiffSurface } from "./DiffSurface";
import { PrSurface } from "./PrSurface";
import { LinkedPrSurface, type LinkedSessionItem } from "./LinkedPrSurface";
import type { LinkedWorkItem } from "../../sessions/model/session";
import type { OpenFileFn } from "../../search/model/search";

interface Props {
  state: RightPanelState;
  dispatch: React.Dispatch<RightPanelAction>;
  detectedPort?: number;
  cwd?: string;
  activeSessionId?: string | null;
  activeSessionLinkedWorkItem?: LinkedWorkItem | null;
  onSetLinkedWorkItem?: (item: LinkedWorkItem | undefined) => void;
  linkedSessions?: LinkedSessionItem[];
  onOpenSession?: (sessionId: string) => void;
  onOpenProjectTerminal?: () => void;
  onOpenProjectDiff?: () => void;
  onOpenProjectFiles?: () => void;
  onOpenFile?: OpenFileFn;
}

function surfaceTabIcon(type: SurfaceType) {
  switch (type) {
    case "browser":
      return Globe;
    case "terminal":
      return Terminal;
    case "files":
      return File;
    case "diff":
      return FileDiff;
    case "pr":
      return GitPullRequest;
    case "linked_pr":
      return ExternalLink;
    case "device":
      return SmartPhone;
    case "picker":
      return Plus;
  }
}

export function RightPanelContainer({
  state,
  dispatch,
  detectedPort,
  cwd,
  activeSessionId,
  activeSessionLinkedWorkItem,
  onSetLinkedWorkItem,
  linkedSessions,
  onOpenSession,
  onOpenProjectTerminal,
  onOpenProjectDiff,
  onOpenProjectFiles,
  onOpenFile,
}: Props) {
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const observationOwner = useRef({ tabs: state.tabs, dispatch });
  observationOwner.current = { tabs: state.tabs, dispatch };
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void listenBrowserNavigation(event => {
      if (disposed) return;
      const owner = observationOwner.current;
      if (!owner.tabs.some(tab => tab.id === event.tabId && (tab.type === "browser" || tab.type === "device"))) return;
      owner.dispatch({ type: "native_observation", tabId: event.tabId, url: event.url, title: event.title ?? undefined, loading: event.loading, kind: event.kind, canGoBack: event.canGoBack, canGoForward: event.canGoForward });
    }).then(stop => { if (disposed) stop(); else unsubscribe = stop; }).catch(console.error);
    return () => { disposed = true; unsubscribe?.(); };
  }, []);
  const [browserBlocked, setBrowserBlocked] = useState(hasVisibleRightPanelOverlay);
  useEffect(() => {
    if (!state.isOpen) return;
    return observeRightPanelOverlays(setBrowserBlocked);
  }, [state.isOpen]);
  const nativeTabs = useRef<string[]>([]);
  const previousNativeTab = useRef<string | undefined>(undefined);

  // Resizing state & refs
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!isResizing) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [isResizing]);

  const handlePointerDownResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (state.mode === "fullscreen") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: state.width };
    setIsResizing(true);
  };

  const handlePointerMoveResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const deltaX = dragRef.current.startX - e.clientX;
    const nextWidth = clampRightPanelWidth(dragRef.current.startWidth + deltaX);
    dispatch({ type: "set_width", width: nextWidth });
  };

  const handlePointerUpResize = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
  };

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];

  useEffect(() => {
    const current = state.isOpen && (activeTab?.type === "browser" || activeTab?.type === "device") ? activeTab.id : undefined;
    if (!current) void Promise.resolve(hideBrowser()).catch(console.error);
    else if (previousNativeTab.current && previousNativeTab.current !== current) {
      void Promise.resolve(hideBrowser(previousNativeTab.current)).catch(console.error);
    }
    previousNativeTab.current = current;
  }, [state.isOpen, activeTab?.id, activeTab?.type]);

  useEffect(() => {
    const current = state.tabs.filter(tab => tab.type === "browser" || tab.type === "device").map(tab => tab.id);
    for (const removed of nativeTabs.current.filter(id => !current.includes(id))) {
      void closeBrowser(removed).catch(console.error);
    }
    nativeTabs.current = current;
  }, [state.tabs]);

  useEffect(() => () => { void Promise.resolve(hideBrowser()).catch(console.error); }, []);

  useEffect(() => {
    if (!state.isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !canHandleRightPanelShortcut(event)) return;
      event.preventDefault();
      const browserTab = activeTab?.type === "browser"
        ? activeTab
        : state.tabs.find((tab) => tab.type === "browser");
      if (browserTab) {
        dispatch({ type: "select_tab", tabId: browserTab.id });
      } else if (activeTab?.type === "picker") {
        dispatch({ type: "replace_tab_surface", tabId: activeTab.id, surfaceType: "browser" });
      } else {
        dispatch({ type: "open_surface", surfaceType: "browser" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.isOpen, state.tabs, activeTab, dispatch]);

  if (!state.isOpen) return null;

  const handleSelectSurface = (surfaceType: SurfaceType) => {
    if (activeTab?.type === "picker") {
      dispatch({ type: "replace_tab_surface", tabId: activeTab.id, surfaceType });
    } else {
      dispatch({ type: "open_surface", surfaceType });
    }

    if (surfaceType === "diff" && onOpenProjectDiff) {
      onOpenProjectDiff();
    } else if (surfaceType === "files" && onOpenProjectFiles) {
      onOpenProjectFiles();
    }
  };

  const isFullscreen = state.mode === "fullscreen";

  return (
    <aside
      aria-label="Right Panel Surfaces"
      style={isFullscreen ? undefined : { width: state.width }}
      className={`relative z-20 flex min-h-0 flex-col text-content select-none overflow-hidden bg-background-base/25 backdrop-blur-md ${
        isFullscreen
          ? "absolute inset-0 z-40 w-full h-full"
          : "h-full border-l border-stroke/40 shrink-0"
      }`}
    >
      {/* Barra de redimensionamiento izquierda (solo en modo dock) */}
      {!isFullscreen ? (
        <div
          onPointerDown={handlePointerDownResize}
          onPointerMove={handlePointerMoveResize}
          onPointerUp={handlePointerUpResize}
          onPointerCancel={handlePointerUpResize}
          title="Arrastrar para redimensionar el panel"
          className="absolute inset-y-0 left-0 z-30 w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors"
        />
      ) : null}

      {/* Header superior: Pestañas + Controles */}
      <div className="relative z-10 flex h-10 w-full shrink-0 items-center justify-between border-b border-stroke bg-white/[0.03] px-2 backdrop-blur-md">
        {/* Lista de Pestañas */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none pr-2">
          {state.tabs.map((tab) => {
            const Icon = surfaceTabIcon(tab.type);
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                onClick={() => dispatch({ type: "select_tab", tabId: tab.id })}
                className={`group flex h-7 max-w-44 min-w-28 cursor-pointer items-center justify-between rounded-lg px-2.5 text-xs transition-colors ${
                  isActive
                    ? "bg-white/10 text-content font-medium shadow-sm border border-stroke/60"
                    : "text-content/60 hover:bg-white/5 hover:text-content"
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5 truncate">
                  <Icon className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" strokeWidth={1.75} />
                  <span className="truncate">{tab.title}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Cerrar pestaña ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "close_tab", tabId: tab.id });
                  }}
                  className="ml-1 flex size-4 items-center justify-center rounded text-content/40 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-content transition-all"
                >
                  <X className="size-2.5" strokeWidth={2} />
                </button>
              </div>
            );
          })}

          {/* Botón '+' para abrir una nueva superficie */}
          <button
            ref={plusButtonRef}
            type="button"
            aria-label="Abrir una superficie"
            title="Open a surface"
            onClick={() => dispatch({ type: "open_surface", surfaceType: "picker" })}
            className="flex size-7 items-center justify-center rounded-lg text-content/60 hover:bg-white/10 hover:text-content transition-colors"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* Botones de control del panel a la derecha */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Botón Full Screen ⛶ */}
          <button
            type="button"
            aria-label={isFullscreen ? "Restaurar a panel derecho" : "Pantalla completa"}
            title={isFullscreen ? "Restaurar a panel derecho" : "Pantalla completa (Full Screen)"}
            onClick={() => dispatch({ type: "toggle_mode" })}
            className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
              isFullscreen
                ? "bg-accent/20 text-accent font-semibold"
                : "text-content/60 hover:bg-white/10 hover:text-content"
            }`}
          >
            <Maximize2 className="size-3.5" strokeWidth={1.75} />
          </button>

          {/* Botón Toggle Right Panel [ | ] */}
          <button
            type="button"
            aria-label="Cerrar Right Panel"
            title="Cerrar Right Panel"
            onClick={() => dispatch({ type: "toggle_open" })}
            className="flex size-7 items-center justify-center rounded-lg text-content/60 hover:bg-white/10 hover:text-content transition-colors"
          >
            <PanelRight className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Cuerpo del Surface Activo */}
      <div className="relative z-10 flex-1 w-full min-h-0 overflow-hidden bg-transparent">
        {/* Vista 'Open a surface' centrada cuando no hay pestañas o la activa es 'picker' */}
        {state.tabs.length === 0 || activeTab?.type === "picker" ? (
          <OpenSurfaceView onSelect={handleSelectSurface} />
        ) : null}

        {/* Superficies de Terminal montadas en segundo plano (para preservar el PTY) */}
        {state.tabs
          .filter((tab) => tab.type === "terminal")
          .map((tab) => {
            const isTabActive = activeTab?.id === tab.id;
            return (
              <div
                key={tab.id}
                aria-hidden={!isTabActive}
                className={
                  isTabActive
                    ? "absolute inset-0 h-full w-full bg-background-base/40 backdrop-blur-md"
                    : "hidden"
                }
              >
                <TerminalView
                  id={`right-panel-${tab.id}`}
                  cwd={cwd || "~"}
                  active={isTabActive}
                  onMetaChange={(patch) => {
                    if (patch.title) {
                      dispatch({
                        type: "set_tab_title",
                        tabId: tab.id,
                        title: patch.title,
                      });
                    }
                  }}
                />
              </div>
            );
          })}

        {/* Superficie de Navegador */}
        {activeTab && activeTab.type === "browser" ? (
          <BrowserSurface
            tab={activeTab}
            blocked={browserBlocked}
            onNativeNavigate={() => { /* The panel owner records every tab's observations. */ }}
            onNavigate={(tabId, url, title) =>
              dispatch({ type: "navigate", tabId, url, title })
            }
            onGoBack={(tabId) => dispatch({ type: "go_back", tabId })}
            onGoForward={(tabId) => dispatch({ type: "go_forward", tabId })}
            onReload={(tabId) => dispatch({ type: "reload_tab", tabId })}
            onOpenSurface={handleSelectSurface}
            detectedPort={detectedPort}
          />
        ) : null}

        {/* Superficie de Dispositivos (Móvil / Tablet) */}
        {activeTab && activeTab.type === "device" ? (
          <DeviceSurface
            tab={activeTab}
            blocked={browserBlocked}
            onNativeNavigate={() => { /* The panel owner records every tab's observations. */ }}
            onNavigate={(tabId, url, title) =>
              dispatch({ type: "navigate", tabId, url, title })
            }
            onGoBack={(tabId) => dispatch({ type: "go_back", tabId })}
            onGoForward={(tabId) => dispatch({ type: "go_forward", tabId })}
            onReload={(tabId) => dispatch({ type: "reload_tab", tabId })}
            onOpenSurface={handleSelectSurface}
            onSetPreset={(tabId, preset: DevicePreset) =>
              dispatch({ type: "set_device_preset", tabId, preset })
            }
            detectedPort={detectedPort}
          />
        ) : null}

        {/* Superficie de Explorador e Inspector de Archivos */}
        {activeTab && activeTab.type === "files" ? (
          <FilesSurface cwd={cwd} onOpenFile={onOpenFile} />
        ) : null}

        {/* Superficie de Inspección de Cambios (Diff) */}
        {activeTab && activeTab.type === "diff" ? (
          <DiffSurface cwd={cwd} onOpenFile={onOpenFile} />
        ) : null}

        {/* Superficie de Pull Request (directo del repositorio) */}
        {activeTab && activeTab.type === "pr" ? (
          <PrSurface cwd={cwd} onOpenFile={onOpenFile} />
        ) : null}

        {/* Superficie de Linked Pull Requests (vinculado al chat / workspace) */}
        {activeTab && activeTab.type === "linked_pr" ? (
          <LinkedPrSurface
            cwd={cwd}
            activeSessionId={activeSessionId}
            activeSessionLinkedWorkItem={activeSessionLinkedWorkItem}
            onSetLinkedWorkItem={onSetLinkedWorkItem}
            linkedSessions={linkedSessions}
            onOpenSession={onOpenSession}
            onOpenFile={onOpenFile}
          />
        ) : null}

        {/* Superficies nativas restantes */}
        {activeTab &&
        activeTab.type !== "browser" &&
        activeTab.type !== "device" &&
        activeTab.type !== "terminal" &&
        activeTab.type !== "files" &&
        activeTab.type !== "diff" &&
        activeTab.type !== "pr" &&
        activeTab.type !== "linked_pr" &&
        activeTab.type !== "picker" ? (
          <NativeSurfacePlaceholder
            tab={activeTab}
            onOpenTerminal={onOpenProjectTerminal}
            onOpenDiff={onOpenProjectDiff}
            onOpenFiles={onOpenProjectFiles}
          />
        ) : null}
      </div>
    </aside>
  );
}

function NativeSurfacePlaceholder({
  tab,
  onOpenTerminal,
  onOpenDiff,
  onOpenFiles,
}: {
  tab: RightPanelTab;
  onOpenTerminal?: () => void;
  onOpenDiff?: () => void;
  onOpenFiles?: () => void;
}) {
  const Icon = surfaceTabIcon(tab.type);

  const getAction = () => {
    switch (tab.type) {
      case "terminal":
        return { label: "Abrir Terminal de Proyecto", action: onOpenTerminal };
      case "diff":
        return { label: "Ver Cambios / Diff", action: onOpenDiff };
      case "files":
        return { label: "Abrir Explorador de Archivos", action: onOpenFiles };
      default:
        return null;
    }
  };

  const action = getAction();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center text-content select-none">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.04] text-content/70 border border-stroke">
        <Icon className="size-7" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <h3 className="text-sm font-semibold text-content">{tab.title}</h3>
        <p className="text-xs text-content/50">
          Superficie nativa activa en MonoCode. Podés interactuar directamente o enfocarla en el workspace.
        </p>
      </div>
      {action && action.action ? (
        <button
          type="button"
          onClick={action.action}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-content hover:bg-accent/90 transition-colors shadow-sm"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
