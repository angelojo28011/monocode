// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrSurface } from "./PrSurface";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("react-material-icon-theme", () => ({
  getFileIcon: ({ fileExtension }: { fileExtension?: string }) => fileExtension ?? "file",
  getFolderIcon: ({ isOpen }: { isOpen: boolean }) => (isOpen ? "folder-open" : "folder"),
  getIconSvg: (name: string) => `<svg data-icon="${name}"><path /></svg>`,
}));

vi.mock("../../../platform/tauri/fs", () => ({
  gitBranches: vi.fn(async () => ({
    current: "feature-test",
    detached: false,
    branches: [
      { name: "main", current: false, remote: "origin/main" },
      { name: "feature-test", current: true, remote: null },
    ],
  })),
}));

vi.mock("../../inbox/model/githubTasks", () => ({
  githubRepo: vi.fn(async () => "acme/kuota"),
  listGithubWorkItems: vi.fn(async () => [
    {
      kind: "pr",
      number: 42,
      title: "Nueva funcionalidad para el Right Panel",
      url: "https://github.com/acme/kuota/pull/42",
      state: "open",
      draft: false,
      repo: "acme/kuota",
      updatedAt: "2026-03-29T10:00:00Z",
      labels: [{ name: "feature", color: "10b981" }],
      assignees: [],
    },
  ]),
  githubWorkItemDetails: vi.fn(async () => ({
    body: "Esta es la descripción detallada del PR para testing.",
    author: "angel",
    authorAvatarUrl: "",
    baseRefName: "main",
    headRefName: "feature-test",
    reviewDecision: "APPROVED",
  })),
  githubWorkItemThread: vi.fn(async () => ({
    comments: [
      {
        id: "c1",
        kind: "comment",
        author: "reviewer",
        authorAvatarUrl: "",
        body: "¡Buen trabajo con este PR!",
        createdAt: "2026-03-29T10:30:00Z",
        url: "https://github.com/acme/kuota/pull/42#c1",
        state: "open",
        path: "",
        line: null,
        resolved: false,
        threadId: "t1",
        replies: [],
      },
    ],
    commits: [],
    truncated: false,
    reviewDecision: "APPROVED",
    baseRefName: "main",
    headRefName: "feature-test",
  })),
  githubPrDiff: vi.fn(async () => ({
    additions: 15,
    deletions: 3,
    files: [
      {
        path: "src/RightPanel.tsx",
        additions: 15,
        deletions: 3,
        status: "modified",
      },
    ],
    patch: "diff --git a/src/RightPanel.tsx...",
    truncated: false,
  })),
  formatRelativeTime: vi.fn(() => "hace 2 horas"),
}));

vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: vi.fn(() => ({
    checks: {
      checks: [
        {
          name: "build-and-test",
          state: "pass",
          description: "All tests passed",
          url: "https://github.com/acme/kuota/actions/1",
        },
      ],
    },
    loading: false,
    refreshing: false,
    error: null,
    stale: false,
    refresh: vi.fn(),
  })),
}));

vi.mock("../../inbox/model/githubPrChecks", () => ({
  summarizePrChecks: vi.fn(() => ({
    kind: "pass",
    description: "Todos los checks pasaron con éxito",
  })),
}));

vi.mock("../../inbox/ui/InboxPrDiff", () => ({
  InboxPrDiff: ({ diff }: { diff: { files: Array<{ path: string }> } }) =>
    createElement("div", { "data-testid": "inbox-pr-diff" }, `${diff.files.length} archivos en diff`),
}));

vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", { "data-testid": "markdown" }, text),
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
  vi.unstubAllGlobals();
});

describe("PrSurface Smoke Test", () => {
  it("renders active PR details, branches, and switches tabs smoothly", async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(createElement(PrSurface, { cwd: "D:/Proyectos/Kuota", onOpenFile }));
    });

    // Validar contenedor de superficie PR
    const surface = container.querySelector('[data-surface="pr"]');
    expect(surface).not.toBeNull();

    // Validar título y número del PR
    expect(container.textContent).toContain("Nueva funcionalidad para el Right Panel");
    expect(container.textContent).toContain("#42");
    expect(container.textContent).toContain("feature-test");
    expect(container.textContent).toContain("main");
    expect(container.textContent).toContain("Por angel");

    // Validar checks y descripción en la pestaña inicial (Resumen)
    expect(container.textContent).toContain("Checks de CI / Actions");
    expect(container.textContent).toContain("Todos los checks pasaron con éxito");
    expect(container.textContent).toContain("Esta es la descripción detallada del PR para testing.");

    // Cambiar a la pestaña de Archivos
    const filesTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Archivos"),
    );
    expect(filesTabBtn).toBeDefined();

    await act(async () => {
      filesTabBtn?.click();
    });

    expect(container.textContent).toContain("src/RightPanel.tsx");
    expect(container.textContent).toContain("+15");
    expect(container.textContent).toContain("-3");
    expect(container.querySelector('[data-testid="inbox-pr-diff"]')).not.toBeNull();

    // Cambiar a la pestaña de Discusión
    const discussionTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Discusión"),
    );
    expect(discussionTabBtn).toBeDefined();

    await act(async () => {
      discussionTabBtn?.click();
    });

    expect(container.textContent).toContain("reviewer");
    expect(container.textContent).toContain("¡Buen trabajo con este PR!");
  });

  it("renders empty state when there are no open PRs", async () => {
    const { listGithubWorkItems } = await import("../../inbox/model/githubTasks");
    vi.mocked(listGithubWorkItems).mockResolvedValueOnce([]);

    await act(async () => {
      root.render(createElement(PrSurface, { cwd: "D:/Proyectos/Kuota" }));
    });

    expect(container.textContent).toContain("Sin Pull Requests abiertos");
    expect(container.textContent).toContain("feature-test");
  });

  it("renders error state when repo has no GitHub remote", async () => {
    const { githubRepo } = await import("../../inbox/model/githubTasks");
    vi.mocked(githubRepo).mockResolvedValueOnce("" as any);

    await act(async () => {
      root.render(createElement(PrSurface, { cwd: "D:/Proyectos/Kuota" }));
    });

    expect(container.textContent).toContain("No se detectó un repositorio remoto de GitHub");
  });
});
