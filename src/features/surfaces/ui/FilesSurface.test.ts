// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesSurface } from "./FilesSurface";

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
  listDir: vi.fn(async (path: string) => [
    { name: "src", path: `${path}/src`, isDir: true, ignored: false },
    { name: "README.md", path: `${path}/README.md`, isDir: false, ignored: false },
    { name: "package.json", path: `${path}/package.json`, isDir: false, ignored: false },
  ]),
  readTextFile: vi.fn(async (path: string) => {
    if (path.endsWith("README.md")) return "# Hello README";
    if (path.endsWith("package.json")) return '{\n  "name": "test-pkg"\n}';
    throw new Error("File not found");
  }),
}));

vi.mock("../../source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: vi.fn(() => ({
    files: new Map([["D:/test/README.md", "modified"]]),
    dirs: new Map(),
  })),
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

describe("FilesSurface", () => {
  it("renders files surface and lists directories and files for cwd", async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        createElement(FilesSurface, {
          cwd: "D:/test",
          onOpenFile,
        }),
      );
    });

    // Wait for listDir promise to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const surface = container.querySelector('[data-testid="files-surface"]');
    expect(surface).not.toBeNull();

    // Verify elements rendered
    const textContent = container.textContent ?? "";
    expect(textContent).toContain("README.md");
    expect(textContent).toContain("package.json");
    expect(textContent).toContain("src");
    expect(textContent).toContain("test"); // project folder name
  });

  it("selects a file and displays its content", async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        createElement(FilesSurface, {
          cwd: "D:/test",
          onOpenFile,
        }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Find the README.md button and click it
    const buttons = Array.from(container.querySelectorAll("button"));
    const readmeButton = buttons.find((btn) => btn.textContent?.includes("README.md"));
    expect(readmeButton).toBeDefined();

    await act(async () => {
      readmeButton?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Content should show the rendered preview or header
    const textContent = container.textContent ?? "";
    expect(textContent).toContain("README.md");
    expect(textContent).toContain("Hello README");

    // Click 'Abrir en editor'
    const openInEditorBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Abrir en editor"),
    );
    expect(openInEditorBtn).toBeDefined();

    await act(async () => {
      openInEditorBtn?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith("D:/test/README.md");
  });
});
