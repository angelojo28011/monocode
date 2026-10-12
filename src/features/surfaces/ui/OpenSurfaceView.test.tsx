// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OpenSurfaceView } from "./OpenSurfaceView";
import { SURFACE_DEFINITIONS } from "../model/rightPanel";
const host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
afterEach(() => { act(() => root.render(null)); });
it.each(SURFACE_DEFINITIONS.filter(d => d.type !== "browser"))("preserves picker $shortcutKey", def => {
  const onSelect = vi.fn(); act(() => root.render(<OpenSurfaceView onSelect={onSelect} />));
  const event = new KeyboardEvent("keydown", { key: def.shortcutKey.toLowerCase(), cancelable: true });
  act(() => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true); expect(onSelect).toHaveBeenCalledExactlyOnceWith(def.type);
});
it("leaves B to the panel listener while preserving browser click", () => {
  const onSelect = vi.fn(); act(() => root.render(<OpenSurfaceView onSelect={onSelect} />));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }))); expect(onSelect).not.toHaveBeenCalled();
  act(() => (host.querySelector("button") as HTMLButtonElement).click()); expect(onSelect).toHaveBeenCalledExactlyOnceWith("browser");
});
