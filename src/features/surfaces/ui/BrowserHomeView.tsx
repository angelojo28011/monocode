import { useState, useEffect } from "react";
import { Terminal, Globe, Search } from "../../../shared/ui/icons";
import type { SurfaceType } from "../model/rightPanel";
import { normalizeBrowserUrl } from "../../../platform/tauri/browser";

interface Props {
  onOpenSurface: (surfaceType: SurfaceType) => void;
  onNavigate: (url: string, title?: string) => void;
  detectedPort?: number;
}

interface SuggestedItem {
  id: string;
  title: string;
  url: string;
  badge?: string;
}

const DEFAULT_SUGGESTIONS: SuggestedItem[] = [
  {
    id: "google",
    title: "Google",
    url: "https://www.google.com",
    badge: "Web",
  },
  {
    id: "github",
    title: "GitHub",
    url: "https://github.com",
    badge: "Git",
  },
  {
    id: "mdn",
    title: "MDN Web Docs",
    url: "https://developer.mozilla.org",
    badge: "Docs",
  },
  {
    id: "react",
    title: "React Docs",
    url: "https://react.dev",
    badge: "Docs",
  },
  {
    id: "tailwind",
    title: "Tailwind CSS",
    url: "https://tailwindcss.com",
    badge: "CSS",
  },
  {
    id: "localhost-dev",
    title: "Servidor local",
    url: "http://localhost:5173",
    badge: "5173",
  },
];

export function BrowserHomeView({ onOpenSurface, onNavigate, detectedPort }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestedItem[]>(DEFAULT_SUGGESTIONS);

  useEffect(() => {
    if (detectedPort) {
      setSuggestions((prev) => [
        {
          id: `localhost-${detectedPort}`,
          title: `localhost:${detectedPort}`,
          url: `http://localhost:${detectedPort}`,
          badge: "Activo",
        },
        ...prev.filter((p) => p.id !== `localhost-${detectedPort}` && p.id !== "localhost-dev"),
      ]);
    }
  }, [detectedPort]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const normalized = normalizeBrowserUrl(searchInput);
      setInputError("");
      if (normalized) onNavigate(normalized);
    } catch (error) { setInputError(String(error)); }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto px-6 py-8 text-content select-none bg-transparent">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        {/* Buscador Central estilo Google / Startpage */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] border border-stroke/50 text-content shadow-sm">
            <Globe className="size-6 text-accent" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-content tracking-tight">Navegador Web</h1>
            <p className="text-xs text-content/50">
              Ingresá una dirección o buscá en Google directamente
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="w-full mt-1">
            {inputError && <p role="alert" className="text-xs text-content">Solo se admiten direcciones HTTP/HTTPS.</p>}
            <div className="relative flex w-full items-center">
              <Search className="pointer-events-none absolute left-3.5 size-4 text-content/40" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar con Google o ingresar URL (ej. google.com)"
                className="h-10 w-full rounded-xl border border-stroke/60 bg-white/[0.04] pl-10 pr-4 text-sm text-content placeholder:text-content/30 transition-all focus:border-accent/70 focus:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-accent/30 shadow-inner"
              />
            </div>
          </form>
        </div>

        {/* Sección Sitios Frecuentes y Sugeridos */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[11.5px] font-semibold text-content/60 tracking-wider uppercase">
            Accesos directos
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {suggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.url, item.title)}
                className="group flex items-center justify-between gap-2 rounded-xl border border-stroke/40 bg-white/[0.03] p-3 text-left transition-all hover:border-stroke/80 hover:bg-white/[0.07] hover:shadow-xs active:bg-white/10"
              >
                <div className="flex min-w-0 items-center gap-2.5 truncate">
                  <div className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-content/80 group-hover:text-content group-hover:scale-105 transition-transform">
                    <Globe className="size-3.5" strokeWidth={1.75} />
                  </div>
                  <span className="truncate text-xs font-medium text-content/85 group-hover:text-content">
                    {item.title}
                  </span>
                </div>
                {item.badge ? (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono text-content/45 bg-white/[0.04] border border-white/[0.06]">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        {/* Sección Herramientas integradas */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[11.5px] font-semibold text-content/60 tracking-wider uppercase">
            Herramientas
          </h2>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onOpenSurface("terminal")}
              className="group flex w-full items-center justify-between rounded-xl border border-stroke/40 bg-white/[0.03] px-3.5 py-2.5 transition-all hover:border-stroke/80 hover:bg-white/[0.07] active:bg-white/10"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-7.5 items-center justify-center rounded-lg bg-white/[0.06] text-content/80 group-hover:text-content">
                  <Terminal className="size-3.5" strokeWidth={1.75} />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-medium text-content">Terminal</span>
                  <span className="text-[10.5px] text-content/45">Abrir consola de comandos</span>
                </div>
              </div>
              <kbd className="rounded-md border border-stroke/50 bg-white/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-content/50">
                Ctrl+`
              </kbd>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
