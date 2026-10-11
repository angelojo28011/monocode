import { useEffect, useRef } from "react";
import {
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
  isOpen: boolean;
  onClose: () => void;
  onSelect: (surfaceType: SurfaceType) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
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

export function OpenSurfaceMenu({ isOpen, onClose, onSelect }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      const key = event.key.toUpperCase();
      const match = SURFACE_DEFINITIONS.find((def) => def.shortcutKey === key);
      if (match) {
        event.preventDefault();
        onSelect(match.type);
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, onSelect]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-10 right-2 z-50 w-72 rounded-xl border border-stroke bg-[#101012] p-2.5 shadow-2xl backdrop-blur-md"
      role="menu"
      aria-label="Open a surface"
    >
      <div className="mb-2 px-3 py-1.5 text-center text-[13px] font-semibold tracking-wide text-neutral-300">
        Open a surface
      </div>
      <div className="flex flex-col gap-0.5">
        {SURFACE_DEFINITIONS.map((surface) => {
          const Icon = surfaceIcon(surface.type);
          return (
            <button
              key={surface.type}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(surface.type);
                onClose();
              }}
              className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <div className="flex items-center gap-3">
                <Icon className="size-4 shrink-0 text-neutral-400 group-hover:text-white" strokeWidth={1.75} />
                <span className="font-medium text-[13.5px]">{surface.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {surface.type === "browser" ? (
                  <span className="text-[10px] text-neutral-500">▾</span>
                ) : null}
                <kbd className="flex h-5 min-w-5 items-center justify-center rounded bg-white/5 px-1 font-mono text-[11px] font-semibold text-neutral-400 border border-white/10 group-hover:border-white/20 group-hover:text-neutral-200">
                  {surface.shortcutKey}
                </kbd>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
