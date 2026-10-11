import { useEffect } from "react";
import {
  ChevronDown,
  ExternalLink,
  File,
  FileDiff,
  GitPullRequest,
  Globe,
  SmartPhone,
  Terminal,
} from "../../../shared/ui/icons";
import {
  SURFACE_DEFINITIONS,
  type SurfaceType,
} from "../model/rightPanel";

interface Props {
  onSelect: (surfaceType: SurfaceType) => void;
}

function surfaceIcon(type: SurfaceType) {
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
    default:
      return Globe;
  }
}

export function OpenSurfaceView({ onSelect }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = event.key.toUpperCase();
      const match = SURFACE_DEFINITIONS.find((def) => def.shortcutKey === key);
      if (match) {
        event.preventDefault();
        onSelect(match.type);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSelect]);

  return (
    <div
      data-testid="open-surface-view"
      className="relative z-10 flex h-full w-full flex-col items-center justify-center bg-transparent p-6 text-content select-none"
    >
      <div className="flex w-full max-w-[280px] flex-col items-center">
        <h2 className="mb-6 text-center text-[15px] font-semibold tracking-normal text-content">
          Open a surface
        </h2>
        <div className="flex w-full flex-col gap-1.5">
          {SURFACE_DEFINITIONS.map((surface) => {
            const Icon = surfaceIcon(surface.type);
            return (
              <button
                key={surface.type}
                type="button"
                onClick={() => onSelect(surface.type)}
                className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-content/85 transition-colors hover:bg-white/[0.08] hover:text-content active:bg-white/10"
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className="size-4 shrink-0 text-content/60 transition-colors group-hover:text-content"
                    strokeWidth={1.75}
                  />
                  <span className="text-[13.5px] font-normal leading-tight">
                    {surface.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {surface.type === "browser" ? (
                    <ChevronDown
                      className="size-3 text-content/40 transition-colors group-hover:text-content/70"
                      strokeWidth={2}
                    />
                  ) : null}
                  <kbd className="flex h-5 min-w-5 items-center justify-center rounded bg-white/[0.04] px-1 font-mono text-[11px] font-medium text-content/50 border border-white/[0.08] transition-colors group-hover:border-white/20 group-hover:text-content/90">
                    {surface.shortcutKey}
                  </kbd>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
