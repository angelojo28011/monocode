import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Pencil,
  RefreshCw,
  SmartPhone,
  Sparkles,
} from "../../../shared/ui/icons";
import { normalizeBrowserUrl } from "../../../platform/tauri/browser";

interface Props {
  url?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onNavigate: (url: string) => void;
  onAnnotate?: () => void;
  isAnnotating?: boolean;
  isDeviceMode?: boolean;
  onToggleDeviceMode?: () => void;
  webMcpToolsCount?: number;
}

export function BrowserToolbar({
  url = "",
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  onNavigate,
  onAnnotate,
  isAnnotating,
  isDeviceMode,
  onToggleDeviceMode,
  webMcpToolsCount = 0,
}: Props) {
  const [inputUrl, setInputUrl] = useState(url);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeBrowserUrl(inputUrl);
    if (!normalized) return;
    onNavigate(normalized);
  };

  const handleOpenExternal = () => {
    if (url) {
      window.open(url, "_blank");
    }
  };

  // Simplificar visualización de URL cuando no está enfocada (ej. 'google.com' en vez de 'https://www.google.com/')
  const displayUrl = () => {
    if (isFocused) return inputUrl;
    if (!url) return "";
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
      return `${host}${pathname}${parsed.search}`;
    } catch {
      return url;
    }
  };

  return (
    <div className="flex h-11 w-full shrink-0 items-center justify-between gap-2 border-b border-stroke/40 bg-background-base/20 px-3 select-none backdrop-blur-md">
      {/* Grupo Izquierdo: Botones de historial, recargar y botón Anotar (estilo Codex) */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onGoBack}
          disabled={!canGoBack}
          aria-label="Atrás"
          title="Página anterior (Atrás)"
          className="flex size-7 items-center justify-center rounded-md text-content/70 transition-colors hover:bg-white/10 hover:text-content disabled:pointer-events-none disabled:opacity-25"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={onGoForward}
          disabled={!canGoForward}
          aria-label="Adelante"
          title="Página siguiente (Adelante)"
          className="flex size-7 items-center justify-center rounded-md text-content/70 transition-colors hover:bg-white/10 hover:text-content disabled:pointer-events-none disabled:opacity-25"
        >
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={onReload}
          aria-label="Recargar"
          title="Recargar página actual"
          className="flex size-7 items-center justify-center rounded-md text-content/70 transition-colors hover:bg-white/10 hover:text-content"
        >
          <RefreshCw className="size-3.5" strokeWidth={2} />
        </button>

        {/* Botón 'Anotar' (estilo Codex / IA) */}
        {onAnnotate ? (
          <button
            type="button"
            onClick={onAnnotate}
            aria-label="Anotar en la página"
            title="Anotar o seleccionar elementos de la web para el agente"
            className={`ml-1 flex h-6.5 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-all ${
              isAnnotating
                ? "border-accent/80 bg-accent/20 text-accent shadow-xs"
                : "border-stroke/60 bg-white/[0.04] text-content/75 hover:border-stroke hover:bg-white/[0.08] hover:text-content"
            }`}
          >
            <Pencil className="size-3" strokeWidth={2} />
            <span>Anotar</span>
          </button>
        ) : null}
      </div>

      {/* Centro: Cápsula de URL / Buscador (Pill shape centrada estilo Codex) */}
      <form onSubmit={handleSubmit} className="flex min-w-0 max-w-xl flex-1 items-center px-1">
        <div className="relative flex w-full items-center">
          <input
            type="text"
            value={isFocused ? inputUrl : displayUrl()}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={(e) => {
              setIsFocused(true);
              setInputUrl(url || inputUrl);
              e.target.select();
            }}
            onBlur={() => setIsFocused(false)}
            placeholder="google.com o buscar en la web..."
            className="h-7 w-full rounded-full border border-stroke/50 bg-white/[0.04] px-4 text-center font-mono text-[12px] text-content placeholder:text-content/30 transition-all focus:border-accent/60 focus:bg-white/[0.08] focus:text-left focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
      </form>

      {/* Grupo Derecho: Acciones complementarias */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Indicador WebMCP */}
        {webMcpToolsCount > 0 ? (
          <div
            title={`WebMCP: ${webMcpToolsCount} herramientas disponibles para el agente`}
            className="flex h-6.5 items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 text-[10.5px] font-medium text-purple-300"
          >
            <Sparkles className="size-3 text-purple-400" />
            <span>WebMCP</span>
          </div>
        ) : null}

        {/* Emulación de dispositivo móvil */}
        {onToggleDeviceMode ? (
          <button
            type="button"
            onClick={onToggleDeviceMode}
            aria-label="Alternar modo Device"
            title="Alternar emulación de dispositivo móvil"
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              isDeviceMode
                ? "bg-accent/20 text-accent"
                : "text-content/70 hover:bg-white/10 hover:text-content"
            }`}
          >
            <SmartPhone className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}

        {/* Abrir en navegador externo */}
        {url ? (
          <button
            type="button"
            onClick={handleOpenExternal}
            aria-label="Abrir en navegador externo"
            title="Abrir en navegador externo"
            className="flex size-7 items-center justify-center rounded-md text-content/70 transition-colors hover:bg-white/10 hover:text-content"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
