// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffSurface } from "./DiffSurface";

vi.mock("react-material-icon-theme", () => ({
  getFileIcon: ({ fileExtension }: { fileExtension?: string }) => fileExtension ?? "file",
  getFolderIcon: ({ isOpen }: { isOpen: boolean }) => (isOpen ? "folder-open" : "folder"),
  getIconSvg: (name: string) => `<svg data-icon="${name}"><path /></svg>`,
}));

vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => {
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || path;
  },
  gitDiffFiles: vi.fn(async (_cwd: string) => ({
    files: [
      {
        path: "D:/test/src/config.ts",
        relative: "src/config.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
      },
    ],
    additions: 2,
    deletions: 1,
  })),
  gitFileDiff: vi.fn(async (_cwd: string, relative: string) => {
    if (relative === "src/config.ts") {
      return {
        path: "D:/test/src/config.ts",
        relative: "src/config.ts",
        status: "modified",
        original: 'export const PORT = 3000;\nexport const HOST = "localhost";',
        current: 'export const PORT = 8080;\nexport const DEBUG = true;\nexport const HOST = "localhost";',
        binary: false,
        tooLarge: false,
      };
    }
    throw new Error("File not found");
  }),
  subscribeGitChanged: vi.fn(() => () => {}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DiffSurface", () => {
  it("renders diff surface, lists changed files and displays diff lines", async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        createElement(DiffSurface, {
          cwd: "D:/test",
          onOpenFile,
        }),
      );
    });

    // Wait for async gitDiffFiles and gitFileDiff promises to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    const surface = container.querySelector('[data-testid="diff-surface"]');
    expect(surface).not.toBeNull();

    // Changed file should be in the list
    const textContent = container.textContent ?? "";
    expect(textContent).toContain("config.ts");
    expect(textContent).toContain("+2");
    expect(textContent).toContain("-1");

    // Unified diff should show the paired changes with words highlighted
    expect(textContent).toContain("PORT = 3000");
    expect(textContent).toContain("PORT = 8080");
    expect(textContent).toContain("DEBUG = true");

    // Click 'Original' view mode
    const buttons = Array.from(container.querySelectorAll("button"));
    const originalBtn = buttons.find((btn) => btn.textContent?.trim() === "Original");
    expect(originalBtn).toBeDefined();

    await act(async () => {
      originalBtn?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // Original code should be visible
    expect(container.textContent).toContain("PORT = 3000");

    // Click 'Actual' view mode
    const actualBtn = buttons.find((btn) => btn.textContent?.trim() === "Actual");
    expect(actualBtn).toBeDefined();

    await act(async () => {
      actualBtn?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(container.textContent).toContain("PORT = 8080");

    await act(async () => {
      originalBtn?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // Original code should be visible
    expect(container.textContent).toContain("PORT = 3000");

    // Test 'Abrir en editor'
    const openBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Abrir en editor"),
    );
    expect(openBtn).toBeDefined();

    await act(async () => {
      openBtn?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith("D:/test/src/config.ts");
  });
});
