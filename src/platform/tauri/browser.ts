import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

function getActiveWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

export interface BrowserBoundsOptions {
  windowLabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  url?: string;
}

export function normalizeBrowserUrl(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  // Ya tiene protocolo
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Localhost o IP local
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Parece un dominio con TLD (ej: google.com, github.com/user, vite.dev) sin espacios
  if (!/\s/.test(trimmed) && /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // En caso contrario, es una consulta de búsqueda: buscar en Google
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export async function syncBrowserBounds(options: BrowserBoundsOptions): Promise<void> {
  try {
    const windowLabel = options.windowLabel || getActiveWindowLabel();
    await invoke("browser_sync_bounds", {
      windowLabel,
      x: Math.round(options.x),
      y: Math.round(options.y),
      width: Math.round(options.width),
      height: Math.round(options.height),
      visible: options.visible,
      url: options.url,
    });
  } catch (err) {
    console.error("Failed to sync browser bounds:", err);
  }
}

export async function navigateBrowser(url: string): Promise<void> {
  try {
    await invoke("browser_navigate", { url });
  } catch (err) {
    console.error("Failed to navigate browser:", err);
  }
}

export async function hideBrowser(): Promise<void> {
  try {
    await invoke("browser_hide");
  } catch (err) {
    console.error("Failed to hide browser:", err);
  }
}

export async function showBrowser(): Promise<void> {
  try {
    await invoke("browser_show");
  } catch (err) {
    console.error("Failed to show browser:", err);
  }
}

export async function reloadBrowser(): Promise<void> {
  try {
    await invoke("browser_reload");
  } catch (err) {
    console.error("Failed to reload browser:", err);
  }
}

export async function goBackBrowser(): Promise<void> {
  try {
    await invoke("browser_go_back");
  } catch (err) {
    console.error("Failed to go back in browser:", err);
  }
}

export async function goForwardBrowser(): Promise<void> {
  try {
    await invoke("browser_go_forward");
  } catch (err) {
    console.error("Failed to go forward in browser:", err);
  }
}

export async function closeBrowser(): Promise<void> {
  try {
    await invoke("browser_close");
  } catch (err) {
    console.error("Failed to close browser:", err);
  }
}
