// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedPrSurface } from "./LinkedPrSurface";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("react-material-icon-theme", () => ({
  getFileIcon: ({ fileExtension }: { fileExtension?: string }) => fileExtension ?? "file",
  getFolderIcon: ({ isOpen }: { isOpen: boolean }) => (isOpen ? "folder-open" : "folder"),
  getIconSvg: (name: string) => `<svg data-icon="${name}"><path /></svg>`,
}));

vi.mock("../../inbox/model/githubTasks", () => ({
  githubRepo: vi.fn(async () => "acme/kuota"),
  listGithubWorkItems: vi.fn(async () => [
    {
      kind: "pr",
      number: 10,
      title: "Optimizar rendimiento en renderizado",
      url: "https://github.com/acme/kuota/pull/10",
      state: "open",
      draft: false,
      repo: "acme/kuota",
      updatedAt: "2026-03-29T10:00:00Z",
      labels: [],
      assignees: [],
    },
  ]),
  githubWorkItemDetails: vi.fn(async () => ({
    body: "Descripción del PR vinculado.",
    author: "angel",
    authorAvatarUrl: "",
    baseRefName: "main",
    headRefName: "feat/perf",
    reviewDecision: "APPROVED",
  })),
  githubWorkItemThread: vi.fn(async () => ({
    comments: [
      {
        id: "c1",
        kind: "comment",
        author: "reviewer",
        authorAvatarUrl: "",
        body: "Revisado y aprobado.",
        createdAt: "2026-03-29T10:30:00Z",
        url: "https://github.com/acme/kuota/pull/10#c1",
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
    headRefName: "feat/perf",
  })),
  githubPrDiff: vi.fn(async () => ({
    additions: 20,
    deletions: 5,
    files: [
      {
        path: "src/perf.ts",
        additions: 20,
        deletions: 5,
        status: "modified",
      },
    ],
    patch: "diff --git a/src/perf.ts...",
    truncated: false,
  })),
  formatRelativeTime: vi.fn(() => "hace 1 hora"),
}));

vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: vi.fn(() => ({
    checks: {
      checks: [
        {
          name: "ci-test",
          state: "pass",
          description: "Tests passed",
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
    description: "Todos los checks pasaron",
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

describe("LinkedPrSurface Smoke Test", () => {
  it("renders linking view when session has no linked PR, and allows linking", async () => {
    const onSetLinkedWorkItem = vi.fn();
    const linkedSessions = [
      {
        id: "sess-2",
        title: "Sesión de bugfix",
        linkedWorkItem: {
          kind: "pr" as const,
          repo: "acme/kuota",
          number: 5,
          url: "https://github.com/acme/kuota/pull/5",
        },
      },
    ];

    await act(async () => {
      root.render(
        createElement(LinkedPrSurface, {
          cwd: "D:/Proyectos/Kuota",
          activeSessionLinkedWorkItem: null,
          onSetLinkedWorkItem,
          linkedSessions,
        }),
      );
    });

    // Validar estado de vinculación
    expect(container.textContent).toContain("Ningún PR vinculado a esta conversación activa");
    expect(container.textContent).toContain("Vincular por URL o número de PR");
    expect(container.textContent).toContain("#10");
    expect(container.textContent).toContain("Optimizar rendimiento en renderizado");
    expect(container.textContent).toContain("PRs vinculados en otras conversaciones");
    expect(container.textContent).toContain("Sesión de bugfix");

    // Probar hacer clic en 'Vincular a este chat'
    const linkBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Vincular a este chat"),
    );
    expect(linkBtn).toBeDefined();

    await act(async () => {
      linkBtn?.click();
    });

    expect(onSetLinkedWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pr",
        number: 10,
        repo: "acme/kuota",
      }),
    );
  });

  it("renders active linked PR details, CI checks and tabs when session has linked PR", async () => {
    const onSetLinkedWorkItem = vi.fn();
    const activePr = {
      kind: "pr" as const,
      repo: "acme/kuota",
      number: 10,
      url: "https://github.com/acme/kuota/pull/10",
    };

    await act(async () => {
      root.render(
        createElement(LinkedPrSurface, {
          cwd: "D:/Proyectos/Kuota",
          activeSessionLinkedWorkItem: activePr,
          onSetLinkedWorkItem,
        }),
      );
    });

    // Validar que se muestra el PR vinculado
    expect(container.textContent).toContain("PR #10");
    expect(container.textContent).toContain("Vinculado a este chat");
    expect(container.textContent).toContain("Por angel");
    expect(container.textContent).toContain("feat/perf");
    expect(container.textContent).toContain("main");
    expect(container.textContent).toContain("Descripción del PR vinculado.");
    expect(container.textContent).toContain("Checks de CI / Actions");

    // Probar cambiar a la pestaña Archivos
    const filesTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Archivos"),
    );
    expect(filesTabBtn).toBeDefined();

    await act(async () => {
      filesTabBtn?.click();
    });

    expect(container.textContent).toContain("src/perf.ts");
    expect(container.textContent).toContain("+20");
    expect(container.textContent).toContain("-5");

    // Probar cambiar a la pestaña Discusión
    const discussionTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Discusión"),
    );
    expect(discussionTabBtn).toBeDefined();

    await act(async () => {
      discussionTabBtn?.click();
    });

    expect(container.textContent).toContain("reviewer");
    expect(container.textContent).toContain("Revisado y aprobado.");

    // Probar desvincular
    const unlinkBtn = container.querySelector('button[title*="Desvincular"]');
    expect(unlinkBtn).not.toBeNull();

    await act(async () => {
      (unlinkBtn as HTMLButtonElement)?.click();
    });

    expect(onSetLinkedWorkItem).toHaveBeenCalledWith(undefined);
  });
});
