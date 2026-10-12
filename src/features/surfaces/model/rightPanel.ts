export type SurfaceType =
  | "browser"
  | "terminal"
  | "files"
  | "diff"
  | "pr"
  | "linked_pr"
  | "device"
  | "picker";

export type PanelDisplayMode = "dock" | "fullscreen";

export type DevicePreset = "iphone-15" | "pixel-7" | "ipad";

export interface DeviceDimensions {
  name: string;
  width: number;
  height: number;
}

export const DEVICE_PRESETS: Record<DevicePreset, DeviceDimensions> = {
  "iphone-15": { name: "iPhone 15", width: 393, height: 852 },
  "pixel-7": { name: "Pixel 7", width: 412, height: 915 },
  ipad: { name: "iPad Air", width: 820, height: 1180 },
};

export interface SurfaceDefinition {
  type: SurfaceType;
  label: string;
  shortcutKey: string;
  description?: string;
}

export const SURFACE_DEFINITIONS: readonly SurfaceDefinition[] = [
  { type: "browser", label: "Browser", shortcutKey: "B" },
  { type: "terminal", label: "Terminal", shortcutKey: "T" },
  { type: "files", label: "Files", shortcutKey: "F" },
  { type: "diff", label: "Diff", shortcutKey: "D" },
  { type: "pr", label: "Pull request", shortcutKey: "P" },
  { type: "linked_pr", label: "Linked pull requests", shortcutKey: "L" },
  { type: "device", label: "Device", shortcutKey: "M" },
] as const;

export interface RightPanelTab {
  id: string;
  type: SurfaceType;
  title: string;
  url?: string;
  history: string[];
  historyIndex: number;
  devicePreset?: DevicePreset;
  reloadToken: number;
  /** Only explicit address/home navigation increments this; observations and history do not. */
  navigationToken?: number;
  nativeObserved?: boolean;
  isLoading?: boolean;
  nativePending?: { url: string; fromUrl?: string; index?: number; started?: boolean };
  nativeTraversal?: { fromUrl?: string; fromIndex: number; targetIndex: number };
  nativeDepartureUrl?: string;
  nativeCanGoBack?: boolean;
  nativeCanGoForward?: boolean;
}

export interface RightPanelState {
  isOpen: boolean;
  mode: PanelDisplayMode;
  width: number;
  activeTabId: string | null;
  tabs: RightPanelTab[];
}

export const DEFAULT_RIGHT_PANEL_WIDTH = 520;
export const MIN_RIGHT_PANEL_WIDTH = 320;
export const MAX_RIGHT_PANEL_WIDTH = 1200;

export function clampRightPanelWidth(width: number): number {
  if (Number.isNaN(width) || !Number.isFinite(width)) {
    return DEFAULT_RIGHT_PANEL_WIDTH;
  }
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(width)));
}

export function defaultSurfaceTitle(type: SurfaceType): string {
  switch (type) {
    case "browser":
      return "Nueva pestaña";
    case "terminal":
      return "Terminal";
    case "files":
      return "Files";
    case "diff":
      return "Diff";
    case "pr":
      return "Pull Request";
    case "linked_pr":
      return "Linked Pull Requests";
    case "device":
      return "Device Preview";
    case "picker":
      return "Open surface";
  }
}

export function createRightPanelTab(
  type: SurfaceType,
  url?: string,
  title?: string,
  devicePreset: DevicePreset = "iphone-15",
): RightPanelTab {
  const initialUrl = url?.trim() || undefined;
  const initialHistory = initialUrl ? [initialUrl] : [];
  return {
    id: crypto.randomUUID(),
    type,
    title: title?.trim() || defaultSurfaceTitle(type),
    url: initialUrl,
    history: initialHistory,
    historyIndex: initialHistory.length > 0 ? 0 : -1,
    devicePreset: type === "device" ? devicePreset : undefined,
    reloadToken: 0,
  };
}

export function createInitialRightPanelState(): RightPanelState {
  return {
    isOpen: false,
    mode: "dock",
    width: DEFAULT_RIGHT_PANEL_WIDTH,
    activeTabId: null,
    tabs: [],
  };
}

export type BrowserObservationKind = "navigation" | "load" | "title" | "restore";

export type RightPanelAction =
  | { type: "toggle_open" }
  | { type: "set_open"; open: boolean }
  | { type: "set_mode"; mode: PanelDisplayMode }
  | { type: "toggle_mode" }
  | { type: "set_width"; width: number }
  | {
      type: "open_surface";
      surfaceType: SurfaceType;
      url?: string;
      title?: string;
      devicePreset?: DevicePreset;
    }
  | { type: "select_tab"; tabId: string }
  | { type: "close_tab"; tabId: string }
  | { type: "close_other_tabs"; tabId: string }
  | { type: "reorder_tabs"; tabIds: string[] }
  | { type: "navigate"; tabId: string; url: string; title?: string }
  | { type: "native_observation"; tabId: string; url: string; title?: string; loading?: boolean | null; kind?: BrowserObservationKind; canGoBack?: boolean; canGoForward?: boolean }
  | { type: "go_back"; tabId: string }
  | { type: "go_forward"; tabId: string }
  | { type: "reload_tab"; tabId: string }
  | { type: "set_device_preset"; tabId: string; preset: DevicePreset }
  | { type: "set_tab_title"; tabId: string; title: string }
  | { type: "replace_tab_surface"; tabId: string; surfaceType: SurfaceType };

function sameBrowserUrl(first: string | undefined, second: string | undefined): boolean {
  if (first === second) return true;
  try { return !!first && !!second && new URL(first).href === new URL(second).href; }
  catch { return false; }
}

function sameDocumentFragment(first: string | undefined, second: string): boolean {
  try {
    const previous = new URL(first ?? "");
    const next = new URL(second);
    return previous.origin === next.origin && previous.pathname === next.pathname && previous.search === next.search && previous.hash !== next.hash;
  } catch { return false; }
}

function observeNativeTab(tab: RightPanelTab, event: Extract<RightPanelAction, { type: "native_observation" }>): RightPanelTab {
  if (tab.type !== "browser" && tab.type !== "device") return tab;
  const url = event.url.trim();
  const kind = event.kind ?? (event.loading != null ? "load" : event.title ? "title" : "navigation");
  // Navigation without a fresh native query (e.g. fragments) must not reuse old availability.
  const availability = kind === "title" ? {
    ...(event.canGoBack !== undefined ? { nativeCanGoBack: event.canGoBack } : {}),
    ...(event.canGoForward !== undefined ? { nativeCanGoForward: event.canGoForward } : {}),
  } : { nativeCanGoBack: event.canGoBack, nativeCanGoForward: event.canGoForward };
  // Title callbacks describe a document; they must never move the history cursor.
  if (kind === "title") {
    return sameBrowserUrl(tab.url, url) ? { ...tab, ...availability, title: event.title?.trim() || tab.title } : tab;
  }
  const traversal = tab.nativeTraversal;
  const pending = tab.nativePending;
  const fromUrl = traversal?.fromUrl ?? pending?.fromUrl;
  const targetUrl = traversal ? tab.history[traversal.targetIndex] : pending?.url;
  // Ignore late load/navigation callbacks from the document we are leaving.
  const returningRedirect = !traversal && pending?.index !== undefined && pending.started && kind === "load" && event.loading === false;
  if (fromUrl && !sameBrowserUrl(fromUrl, targetUrl) && sameBrowserUrl(url, fromUrl) && !returningRedirect) return tab;
  if (!traversal && !pending && kind === "load" && event.loading === false && sameBrowserUrl(url, tab.nativeDepartureUrl)) return tab;

  const fragment = sameDocumentFragment(tab.history[traversal?.fromIndex ?? tab.historyIndex], url);
  const completed = (kind === "restore" && event.loading !== true) || (kind === "load" && event.loading === false) || (kind === "navigation" && fragment);
  const observed = { ...tab, ...availability, url, nativeObserved: true, isLoading: event.loading ?? tab.isLoading,
    title: event.title?.trim() || (sameBrowserUrl(tab.url, url) ? tab.title : url) };
  if (!completed) {
    return { ...observed, nativePending: traversal ? pending : {
      ...pending, url, fromUrl: pending?.fromUrl ?? tab.history[tab.historyIndex], started: pending?.started || (kind === "load" && event.loading === true),
    } };
  }

  let history = [...tab.history];
  let index = tab.historyIndex;
  if (traversal) {
    const backwards = traversal.targetIndex < traversal.fromIndex;
    const matches = history.map((entry, position) => sameBrowserUrl(entry, url) && (backwards ? position < traversal.fromIndex : position > traversal.fromIndex) ? position : -1).filter(position => position >= 0);
    index = matches.length ? (backwards ? matches[matches.length - 1] : matches[0]) : traversal.targetIndex;
    history[index] = url;
  } else if (pending?.index !== undefined) {
    // An explicit address request already allocated its entry; redirects replace it.
    index = pending.index;
    history[index] = url;
  } else if (sameBrowserUrl(history[index], url)) {
    history[index] = url;
  } else if (kind === "restore" && history.some(entry => sameBrowserUrl(entry, url))) {
    index = history.findIndex(entry => sameBrowserUrl(entry, url));
  } else {
    history = history.slice(0, index + 1);
    history.push(url);
    index = history.length - 1;
  }
  return { ...observed, history, historyIndex: index, nativePending: undefined, nativeTraversal: undefined,
    nativeDepartureUrl: fromUrl ?? (sameBrowserUrl(tab.history[tab.historyIndex], url) ? tab.nativeDepartureUrl : tab.history[tab.historyIndex]), isLoading: false };
}

export function rightPanelReducer(
  state: RightPanelState,
  action: RightPanelAction,
): RightPanelState {
  switch (action.type) {
    case "toggle_open": {
      return { ...state, isOpen: !state.isOpen };
    }

    case "set_open": {
      return { ...state, isOpen: action.open };
    }

    case "set_mode":
      return { ...state, mode: action.mode };

    case "toggle_mode":
      return {
        ...state,
        mode: state.mode === "dock" ? "fullscreen" : "dock",
      };

    case "set_width":
      return {
        ...state,
        width: clampRightPanelWidth(action.width),
      };

    case "open_surface": {
      const newTab = createRightPanelTab(
        action.surfaceType,
        action.url,
        action.title,
        action.devicePreset,
      );
      return {
        ...state,
        isOpen: true,
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      };
    }

    case "replace_tab_surface": {
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId
            ? {
                ...tab,
                type: action.surfaceType,
                title: defaultSurfaceTitle(action.surfaceType),
              }
            : tab,
        ),
      };
    }

    case "set_tab_title": {
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, title: action.title } : tab,
        ),
      };
    }

    case "select_tab": {
      if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    }

    case "close_tab": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1) return state;

      const nextTabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      if (nextTabs.length === 0) {
        return {
          ...state,
          tabs: [],
          activeTabId: null,
          isOpen: false,
        };
      }

      let nextActiveId = state.activeTabId;
      if (state.activeTabId === action.tabId) {
        const fallbackIndex = Math.min(index, nextTabs.length - 1);
        nextActiveId = nextTabs[fallbackIndex]?.id ?? null;
      }

      return {
        ...state,
        tabs: nextTabs,
        activeTabId: nextActiveId,
      };
    }

    case "close_other_tabs": {
      const target = state.tabs.find((tab) => tab.id === action.tabId);
      if (!target) return state;
      return {
        ...state,
        tabs: [target],
        activeTabId: target.id,
      };
    }

    case "reorder_tabs": {
      const tabMap = new Map(state.tabs.map((tab) => [tab.id, tab]));
      const nextTabs: RightPanelTab[] = [];
      for (const id of action.tabIds) {
        const tab = tabMap.get(id);
        if (tab) {
          nextTabs.push(tab);
          tabMap.delete(id);
        }
      }
      for (const remaining of tabMap.values()) {
        nextTabs.push(remaining);
      }
      return { ...state, tabs: nextTabs };
    }

    case "native_observation": {
      return { ...state, tabs: state.tabs.map(tab => tab.id === action.tabId ? observeNativeTab(tab, action) : tab) };
    }

    case "navigate": {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== action.tabId) return tab;
        const trimmedUrl = action.url.trim();
        const index = trimmedUrl === tab.url ? tab.historyIndex : tab.historyIndex + 1;
        const observation = {
          navigationToken: (tab.navigationToken ?? 0) + 1,
          nativeObserved: false,
          nativeTraversal: undefined,
          nativeDepartureUrl: undefined,
          nativePending: { url: trimmedUrl, fromUrl: tab.history[tab.historyIndex], index },
        };
        if (trimmedUrl === tab.url) {
          return { ...tab, ...observation, title: action.title?.trim() || tab.title };
        }
        const nextHistory = tab.history.slice(0, tab.historyIndex + 1);
        nextHistory.push(trimmedUrl);
        return {
          ...tab,
          ...observation,
          url: trimmedUrl,
          title: action.title?.trim() || trimmedUrl || defaultSurfaceTitle(tab.type),
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      });
      return { ...state, tabs: nextTabs };
    }

    case "go_back": {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== action.tabId) return tab;
        if (tab.historyIndex <= 0) return tab;
        const nextIndex = tab.historyIndex - 1;
        const prevUrl = tab.history[nextIndex];
        return {
          ...tab,
          url: prevUrl,
          title: prevUrl || defaultSurfaceTitle(tab.type),
          historyIndex: nextIndex,
          nativePending: undefined,
          nativeTraversal: { fromUrl: tab.history[tab.historyIndex], fromIndex: tab.historyIndex, targetIndex: nextIndex },
          nativeCanGoBack: undefined,
          nativeCanGoForward: undefined,
        };
      });
      return { ...state, tabs: nextTabs };
    }

    case "go_forward": {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== action.tabId) return tab;
        if (tab.historyIndex >= tab.history.length - 1) return tab;
        const nextIndex = tab.historyIndex + 1;
        const nextUrl = tab.history[nextIndex];
        return {
          ...tab,
          url: nextUrl,
          title: nextUrl || defaultSurfaceTitle(tab.type),
          historyIndex: nextIndex,
          nativePending: undefined,
          nativeTraversal: { fromUrl: tab.history[tab.historyIndex], fromIndex: tab.historyIndex, targetIndex: nextIndex },
          nativeCanGoBack: undefined,
          nativeCanGoForward: undefined,
        };
      });
      return { ...state, tabs: nextTabs };
    }

    case "reload_tab": {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== action.tabId) return tab;
        return {
          ...tab,
          reloadToken: tab.reloadToken + 1,
        };
      });
      return { ...state, tabs: nextTabs };
    }

    case "set_device_preset": {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== action.tabId) return tab;
        return {
          ...tab,
          devicePreset: action.preset,
        };
      });
      return { ...state, tabs: nextTabs };
    }

    default:
      return state;
  }
}
