import { useRef, useState } from "react";
import {
  DEVICE_PRESETS,
  type DevicePreset,
  type RightPanelTab,
  type SurfaceType,
} from "../model/rightPanel";
import { BrowserSurface } from "./BrowserSurface";

interface Props {
  tab: RightPanelTab;
  onNavigate: (tabId: string, url: string, title?: string) => void;
  onGoBack: (tabId: string) => void;
  onGoForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onOpenSurface: (surfaceType: SurfaceType) => void;
  onSetPreset: (tabId: string, preset: DevicePreset) => void;
  detectedPort?: number;
  blocked?: boolean;
  onNativeNavigate?: (tabId: string, url: string, loading: boolean, title?: string) => void;
}

export function DeviceSurface({
  tab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onOpenSurface,
  onSetPreset,
  detectedPort,
  blocked,
  onNativeNavigate,
}: Props) {
  const currentPreset = tab.devicePreset ?? "iphone-15";
  const dimensions = DEVICE_PRESETS[currentPreset];
  const [scale, setScale] = useState(0.85);
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full w-full flex-col bg-background-base overflow-hidden">
      {/* Selector de presets de dispositivo */}
      <div className="flex h-10 w-full shrink-0 items-center justify-between border-b border-stroke bg-white/[0.02] px-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-content/60 text-[11px] uppercase tracking-wider">
            Dispositivo:
          </span>
          {(Object.keys(DEVICE_PRESETS) as DevicePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onSetPreset(tab.id, preset)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                currentPreset === preset
                  ? "bg-accent/20 text-accent font-semibold"
                  : "text-content/60 hover:bg-white/5 hover:text-content"
              }`}
            >
              {DEVICE_PRESETS[preset].name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-content/50 text-[11px] font-mono">
          <span>{dimensions.width} × {dimensions.height}</span>
          <span className="text-content/30">•</span>
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="rounded bg-white/5 px-1 py-0.5 text-xs text-content border border-stroke focus:outline-none"
          >
            <option value={0.7}>70%</option>
            <option value={0.85}>85%</option>
            <option value={1.0}>100%</option>
          </select>
        </div>
      </div>

      {/* Canvas con marco de smartphone */}
      <div ref={canvasRef} data-browser-clip className="relative flex flex-1 min-h-0 items-center justify-center overflow-auto p-6 bg-black/20">
        <div
          style={{
            width: dimensions.width,
            height: dimensions.height,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
          }}
          className="relative flex flex-col shrink-0 rounded-[44px] border-[10px] border-[#222] bg-background-base shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden ring-1 ring-white/10"
        >
          {/* Dynamic Island / Notch */}
          <div className="absolute top-2 left-1/2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-black flex items-center justify-end pr-2">
            <div className="size-2.5 rounded-full bg-neutral-900 ring-1 ring-neutral-800" />
          </div>

          <div className="flex-1 min-h-0 w-full pt-4 pb-3 flex flex-col overflow-hidden">
            <BrowserSurface
              tab={tab}
              blocked={blocked}
              clipRef={canvasRef}
              geometryKey={`${currentPreset}:${scale}`}
              onNativeNavigate={onNativeNavigate}
              onNavigate={onNavigate}
              onGoBack={onGoBack}
              onGoForward={onGoForward}
              onReload={onReload}
              onOpenSurface={onOpenSurface}
              isDeviceMode={true}
              detectedPort={detectedPort}
            />
          </div>

          {/* Home indicator bar */}
          <div className="absolute bottom-1 left-1/2 z-30 h-1 w-32 -translate-x-1/2 rounded-full bg-neutral-500/50" />
        </div>
      </div>
    </div>
  );
}
