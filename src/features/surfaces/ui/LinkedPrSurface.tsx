import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  githubRepo,
  listGithubWorkItems,
  githubWorkItemDetails,
  githubWorkItemThread,
  githubPrDiff,
  formatRelativeTime,
  type GithubWorkItem,
  type GithubWorkItemDetails,
  type GithubWorkItemThread,
  type GithubPrDiff,
} from "../../inbox/model/githubTasks";
import { useGithubPrChecks } from "../../inbox/hooks/useGithubPrChecks";
import { summarizePrChecks } from "../../inbox/model/githubPrChecks";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import type { LinkedWorkItem } from "../../sessions/model/session";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { InboxPrDiff } from "../../inbox/ui/InboxPrDiff";
import {
  CheckCircle,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  X,
} from "../../../shared/ui/icons";

export interface LinkedSessionItem {
  id: string;
  title: string;
  linkedWorkItem: LinkedWorkItem;
  updatedAt?: number;
}

interface Props {
  cwd?: string;
  activeSessionId?: string | null;
  activeSessionLinkedWorkItem?: LinkedWorkItem | null;
  onSetLinkedWorkItem?: (item: LinkedWorkItem | undefined) => void;
  linkedSessions?: LinkedSessionItem[];
  onOpenSession?: (sessionId: string) => void;
  onOpenFile?: (path: string) => void;
}

type TabMode = "overview" | "files" | "discussion";

export function LinkedPrSurface({
  cwd,
  activeSessionLinkedWorkItem,
  onSetLinkedWorkItem,
  linkedSessions = [],
  onOpenSession,
  onOpenFile,
}: Props) {
  const [repo, setRepo] = useState<string | null>(null);
  const [openPrs, setOpenPrs] = useState<GithubWorkItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // PR seleccionado para inspección (por defecto el vinculado a la sesión)
  const [inspectedPr, setInspectedPr] = useState<LinkedWorkItem | null>(
    activeSessionLinkedWorkItem ?? null,
  );

  // Mantener sincronizado inspectedPr cuando cambia el vinculado a la sesión
  useEffect(() => {
    if (activeSessionLinkedWorkItem) {
      setInspectedPr(activeSessionLinkedWorkItem);
    }
  }, [activeSessionLinkedWorkItem]);

  const [activeTab, setActiveTab] = useState<TabMode>("overview");
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(null);
  const [thread, setThread] = useState<GithubWorkItemThread | null>(null);
  const [diff, setDiff] = useState<GithubPrDiff | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [focusedFilePath, setFocusedFilePath] = useState<string | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  // Input para vincular manualmente por URL o número
  const [manualInput, setManualInput] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [linkingMode, setLinkingMode] = useState(false);

  // Cargar repositorio y lista de PRs abiertos para vincular
  const loadPrList = useCallback(async () => {
    if (!cwd) {
      setRepo(null);
      setOpenPrs([]);
      return;
    }

    setLoadingList(true);
    setListError(null);

    try {
      const repoName = await githubRepo(cwd).catch(() => null);
      setRepo(repoName);

      if (!repoName) {
        setOpenPrs([]);
        setListError("No se detectó un repositorio remoto de GitHub asociado a esta carpeta.");
        return;
      }

      const prs = await listGithubWorkItems(cwd, repoName, {
        kind: "pr",
        state: "open",
        search: "",
        assignedToMe: false,
      });

      setOpenPrs(prs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setListError(msg);
      setOpenPrs([]);
    } finally {
      setLoadingList(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPrList();
  }, [loadPrList, revision]);

  // Cargar detalles completos del PR actualmente bajo inspección
  useEffect(() => {
    if (!cwd || !inspectedPr) {
      setDetails(null);
      setThread(null);
      setDiff(null);
      return;
    }

    let cancelled = false;
    setLoadingDetails(true);

    const prRepo = inspectedPr.repo || repo || "";

    void Promise.allSettled([
      githubWorkItemDetails(cwd, prRepo, "pr", inspectedPr.number),
      githubWorkItemThread(cwd, prRepo, "pr", inspectedPr.number),
      githubPrDiff(cwd, prRepo, inspectedPr.number),
    ]).then(([detailsRes, threadRes, diffRes]) => {
      if (cancelled) return;
      if (detailsRes.status === "fulfilled") setDetails(detailsRes.value);
      if (threadRes.status === "fulfilled") setThread(threadRes.value);
      if (diffRes.status === "fulfilled") setDiff(diffRes.value);
      setLoadingDetails(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, inspectedPr, repo, revision]);

  // Verificación de checks de CI para el PR inspeccionado
  const checksView = useGithubPrChecks({
    cwd: cwd ?? "",
    repo: inspectedPr?.repo || repo || "",
    number: inspectedPr?.number ?? 0,
    enabled: Boolean(cwd && (inspectedPr?.repo || repo) && inspectedPr?.number),
    open: true,
    revision,
  });

  const overallChecks = summarizePrChecks({
    loading: checksView.loading,
    error: checksView.error,
    checks: checksView.checks?.checks ?? null,
  });

  const handleOpenBrowser = () => {
    if (inspectedPr?.url) {
      void openUrl(inspectedPr.url);
    } else if (repo) {
      void openUrl(`https://github.com/${repo}/pulls`);
    }
  };

  const handleRefresh = () => {
    setRevision((prev) => prev + 1);
    checksView.refresh();
  };

  const handleLinkPr = (item: LinkedWorkItem) => {
    if (onSetLinkedWorkItem) {
      onSetLinkedWorkItem(item);
    }
    setInspectedPr(item);
    setLinkingMode(false);
    setManualInput("");
    setManualError(null);
  };

  const handleUnlink = () => {
    if (onSetLinkedWorkItem) {
      onSetLinkedWorkItem(undefined);
    }
    setInspectedPr(null);
    setLinkingMode(false);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    const query = manualInput.trim();
    if (!query) return;

    // 1. Si es URL completa de GitHub
    const parsedFromUrl = parseGithubWorkItemUrl(query);
    if (parsedFromUrl && parsedFromUrl.kind === "pr") {
      handleLinkPr(parsedFromUrl);
      return;
    }

    // 2. Si es número puro o #número
    const numMatch = query.match(/^#?(\d+)$/);
    if (numMatch && repo) {
      const num = Number(numMatch[1]);
      const item: LinkedWorkItem = {
        kind: "pr",
        repo,
        number: num,
        url: `https://github.com/${repo}/pull/${num}`,
      };
      handleLinkPr(item);
      return;
    }

    setManualError("Por favor ingresá un número de PR (ej. #42) o una URL válida de GitHub.");
  };

  const isInspectedLinkedToCurrentSession =
    Boolean(activeSessionLinkedWorkItem && inspectedPr && activeSessionLinkedWorkItem.number === inspectedPr.number);

  // VISTA 1: Cuando NO hay ningún PR seleccionado para inspección o estamos en modo de vinculación
  if (!inspectedPr || linkingMode) {
    return (
      <div
        data-surface="linked-pr"
        className="flex h-full w-full flex-col bg-transparent text-content overflow-y-auto select-text p-4 gap-4"
      >
        <header className="flex items-center justify-between pb-3 border-b border-stroke/40">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
              <GitPullRequest className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-content leading-tight">
                {linkingMode ? "Vincular otro Pull Request" : "Pull Request Vinculado"}
              </h2>
              <p className="text-[11px] text-content/50">
                {linkingMode
                  ? "Seleccioná un PR para asociar a este chat"
                  : "Ningún PR vinculado a esta conversación activa"}
              </p>
            </div>
          </div>
          {linkingMode && inspectedPr ? (
            <button
              type="button"
              onClick={() => setLinkingMode(false)}
              className="p-1 rounded-md text-content/60 hover:text-content hover:bg-white/[0.08]"
              title="Volver al PR actual"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </header>

        {/* Formulario manual para vincular */}
        <form onSubmit={handleManualSubmit} className="flex flex-col gap-2 rounded-xl bg-white/[0.02] border border-stroke/40 p-3">
          <span className="text-xs font-semibold text-content/80">Vincular por URL o número de PR</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Ej. #42 o https://github.com/..."
              className="flex-1 bg-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-content placeholder:text-content/30 border border-stroke/40 focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 bg-accent text-accent-content font-medium text-xs px-3 py-1.5 rounded-md hover:bg-accent/90 transition-colors shrink-0"
            >
              <Plus className="size-3.5" />
              <span>Vincular</span>
            </button>
          </div>
          {manualError ? <p className="text-[11px] text-rose-400">{manualError}</p> : null}
        </form>

        {/* Lista de PRs abiertos en el repositorio para vincular con 1 clic */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-content/80">PRs abiertos en el repositorio</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-[11px] text-content/50 hover:text-content inline-flex items-center gap-1"
            >
              <RefreshCw className={`size-3 ${loadingList ? "animate-spin" : ""}`} />
              <span>Actualizar</span>
            </button>
          </div>

          {loadingList ? (
            <div className="flex items-center justify-center p-6 gap-2 text-xs text-content/40">
              <LoaderCircle className="size-4 animate-spin text-accent" />
              <span>Buscando PRs abiertos...</span>
            </div>
          ) : openPrs.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {openPrs.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stroke/30 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-accent">#{pr.number}</span>
                      <span className="text-xs font-medium text-content truncate">{pr.title}</span>
                    </div>
                    <span className="text-[10px] text-content/40">
                      Actualizado {formatRelativeTime(pr.updatedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        handleLinkPr({
                          kind: "pr",
                          number: pr.number,
                          repo: repo ?? pr.repo,
                          url: pr.url,
                        })
                      }
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-accent/20 text-accent hover:bg-accent hover:text-accent-content transition-colors"
                    >
                      Vincular a este chat
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center rounded-lg border border-stroke/20 bg-white/[0.01] text-xs text-content/40">
              {listError || "No hay otros Pull Requests abiertos en este repositorio."}
            </div>
          )}
        </section>

        {/* PRs vinculados en otras sesiones de este proyecto */}
        {linkedSessions.length > 0 ? (
          <section className="flex flex-col gap-2 mt-2 pt-3 border-t border-stroke/30">
            <span className="text-xs font-semibold text-content/80">
              PRs vinculados en otras conversaciones ({linkedSessions.length})
            </span>
            <div className="flex flex-col gap-1.5">
              {linkedSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stroke/30 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-accent">
                        #{session.linkedWorkItem.number}
                      </span>
                      <span className="text-xs font-medium text-content truncate">{session.title}</span>
                    </div>
                    <span className="text-[10px] text-content/40 font-mono truncate">
                      {session.linkedWorkItem.repo}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectedPr(session.linkedWorkItem)}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-white/[0.06] text-content/75 hover:bg-white/[0.12] transition-colors"
                    >
                      Inspeccionar
                    </button>
                    {onOpenSession ? (
                      <button
                        type="button"
                        onClick={() => onOpenSession(session.id)}
                        className="px-2 py-1 text-[11px] font-medium rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                        title="Ir a este chat"
                      >
                        Ir al chat
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  // VISTA 2: Inspección completa del PR vinculado
  return (
    <div
      data-surface="linked-pr"
      className="flex h-full w-full flex-col bg-transparent text-content overflow-hidden select-text"
    >
      {/* Cabecera del PR vinculado */}
      <header className="flex flex-col border-b border-stroke/40 bg-white/[0.02] px-3 py-2.5 gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Estado del PR */}
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                details?.reviewDecision === "APPROVED"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-white/[0.06] text-content/75 border-stroke/50"
              }`}
            >
              <GitPullRequest className="size-3 text-accent" />
              <span>PR #{inspectedPr.number}</span>
            </div>

            {/* Badge de vinculación con la sesión activa */}
            {isInspectedLinkedToCurrentSession ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 select-none">
                Vinculado a este chat
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkPr(inspectedPr)}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-accent hover:text-accent-content transition-colors border border-stroke/40"
                title="Vincular este PR a la conversación actual"
              >
                + Vincular a este chat
              </button>
            )}
          </div>

          {/* Acciones de cabecera */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setLinkingMode(true)}
              title="Cambiar o vincular otro PR"
              className="px-2 py-1 rounded-md text-xs font-medium text-content/70 hover:text-content hover:bg-white/[0.08] transition-colors"
            >
              Cambiar
            </button>
            {isInspectedLinkedToCurrentSession ? (
              <button
                type="button"
                onClick={handleUnlink}
                title="Desvincular este PR de este chat"
                className="p-1 rounded-md text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleRefresh}
              title="Recargar información del PR"
              className="p-1 rounded-md text-content/60 hover:text-content hover:bg-white/[0.08] transition-colors"
            >
              <RefreshCw className={`size-3.5 ${loadingDetails ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={handleOpenBrowser}
              title="Abrir este Pull Request en GitHub"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-content/80 hover:text-content hover:bg-white/[0.08] transition-colors"
            >
              <ExternalLink className="size-3.5" />
              <span>GitHub</span>
            </button>
          </div>
        </div>

        {/* Título del PR */}
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-content leading-snug break-words">
            {diff ? `PR #${inspectedPr.number}` : `Pull Request #${inspectedPr.number}`}
          </h2>

          {/* Ramas y autor */}
          <div className="flex items-center flex-wrap gap-2 text-[11px] text-content/50">
            {details?.headRefName && details?.baseRefName ? (
              <div className="inline-flex items-center gap-1 font-mono text-[11px] text-content/75 bg-white/[0.03] px-1.5 py-0.5 rounded border border-stroke/30">
                <GitBranch className="size-2.5 text-accent" />
                <span className="text-accent">{details.headRefName}</span>
                <span className="text-content/30">→</span>
                <span>{details.baseRefName}</span>
              </div>
            ) : null}

            {details?.author ? (
              <span>
                Por <strong className="text-content/80 font-medium">{details.author}</strong>
              </span>
            ) : null}

            <span className="font-mono text-content/40">{inspectedPr.repo}</span>
          </div>
        </div>

        {/* Sub-tabs de navegación */}
        <div className="flex items-center gap-1 border-t border-stroke/30 pt-2 -mb-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "overview"
                ? "bg-accent/20 text-accent font-semibold"
                : "text-content/60 hover:text-content hover:bg-white/[0.04]"
            }`}
          >
            Resumen
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "files"
                ? "bg-accent/20 text-accent font-semibold"
                : "text-content/60 hover:text-content hover:bg-white/[0.04]"
            }`}
          >
            <span>Archivos</span>
            {diff?.files ? (
              <span className="text-[10px] font-mono px-1 rounded-sm bg-white/[0.08]">
                {diff.files.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("discussion")}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === "discussion"
                ? "bg-accent/20 text-accent font-semibold"
                : "text-content/60 hover:text-content hover:bg-white/[0.04]"
            }`}
          >
            <span>Discusión</span>
            {thread?.comments ? (
              <span className="text-[10px] font-mono px-1 rounded-sm bg-white/[0.08]">
                {thread.comments.length}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {/* Contenido según pestaña activa */}
      <div className="flex-1 overflow-y-auto">
        {loadingDetails && !details ? (
          <div className="flex h-32 items-center justify-center gap-2 text-content/50 text-xs">
            <LoaderCircle className="size-4 animate-spin text-accent" />
            <span>Cargando contenido del PR...</span>
          </div>
        ) : null}

        {/* 1. RESUMEN */}
        {activeTab === "overview" ? (
          <div className="flex flex-col gap-3 p-3 text-xs">
            {/* Banner de CI Checks */}
            <div className="flex flex-col gap-2 rounded-xl border border-stroke/40 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChecksIcon kind={overallChecks.kind} />
                  <span className="font-semibold text-content text-xs">Checks de CI / Actions</span>
                </div>
                <span className="text-[11px] text-content/50">
                  {checksView.checks?.checks?.length ?? 0} ejecutados
                </span>
              </div>
              <p className="text-[11px] text-content/60">{overallChecks.description}</p>

              {checksView.checks?.checks && checksView.checks.checks.length > 0 ? (
                <div className="flex flex-col gap-1 mt-1 border-t border-stroke/20 pt-2">
                  {checksView.checks.checks.map((check, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-0.5 text-[11px] text-content/75"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <CheckStateIcon state={check.state} />
                        <span className="truncate">{check.name}</span>
                      </div>
                      {check.url ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (check.url) void openUrl(check.url);
                          }}
                          className="shrink-0 text-content/40 hover:text-accent p-0.5 ml-2"
                          title="Ver log del check"
                        >
                          <ExternalLink className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Descripción en Markdown */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-stroke/40 bg-white/[0.02] p-3">
              <span className="text-[11px] font-semibold text-content/60 uppercase tracking-wider">
                Descripción
              </span>
              <div className="text-xs text-content/85 leading-relaxed">
                {details?.body?.trim() ? (
                  <AgentMarkdown text={details.body} cwd={cwd} allowRemoteMedia />
                ) : (
                  <span className="text-content/40 italic">Sin descripción proporcionada.</span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* 2. ARCHIVOS / DIFF */}
        {activeTab === "files" ? (
          <div className="flex flex-col h-full">
            {diff ? (
              <>
                <div className="flex items-center justify-between px-3 py-2 border-b border-stroke/30 bg-white/[0.02] text-xs">
                  <span className="text-content/70 font-medium">
                    {diff.files.length} archivo{diff.files.length === 1 ? "" : "s"} modificado{diff.files.length === 1 ? "" : "s"}
                  </span>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-emerald-400 font-semibold">+{diff.additions}</span>
                    <span className="text-rose-400 font-semibold">-{diff.deletions}</span>
                  </div>
                </div>

                <div className="flex flex-col divide-y divide-stroke/20 max-h-48 overflow-y-auto border-b border-stroke/30 shrink-0 bg-white/[0.01]">
                  {diff.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => {
                        setFocusedFilePath(file.path);
                        if (onOpenFile && cwd) onOpenFile(file.path);
                      }}
                      className={`flex items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.04] ${
                        focusedFilePath === file.path ? "bg-accent/10" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileTypeIcon name={file.path.split("/").pop() ?? file.path} isDir={false} size={14} />
                        <span className="truncate text-content/80 font-mono text-[11px]">{file.path}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        {file.additions > 0 ? (
                          <span className="text-emerald-400">+{file.additions}</span>
                        ) : null}
                        {file.deletions > 0 ? (
                          <span className="text-rose-400">-{file.deletions}</span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex-1 p-2">
                  <InboxPrDiff diff={diff} focusPath={focusedFilePath} />
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-xs text-content/40">
                No hay información de diff disponible para este Pull Request.
              </div>
            )}
          </div>
        ) : null}

        {/* 3. DISCUSIÓN */}
        {activeTab === "discussion" ? (
          <div className="flex flex-col gap-3 p-3">
            {thread?.comments && thread.comments.length > 0 ? (
              thread.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex flex-col gap-2 rounded-xl border border-stroke/40 bg-white/[0.02] p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {comment.authorAvatarUrl ? (
                        <img
                          src={comment.authorAvatarUrl}
                          alt={comment.author}
                          className="size-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="size-5 rounded-full bg-accent/20 flex items-center justify-center font-bold text-[10px] text-accent">
                          {comment.author[0]?.toUpperCase() ?? "U"}
                        </div>
                      )}
                      <span className="font-semibold text-content">{comment.author}</span>
                    </div>
                    <span className="text-[11px] text-content/40">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>

                  <div className="text-xs text-content/85 leading-relaxed">
                    <AgentMarkdown text={comment.body} cwd={cwd} allowRemoteMedia />
                  </div>

                  {comment.replies && comment.replies.length > 0 ? (
                    <div className="flex flex-col gap-2 mt-2 pl-3 border-l-2 border-stroke/40">
                      {comment.replies.map((reply) => (
                        <div key={reply.id} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-content/80">{reply.author}</span>
                            <span className="text-content/40">{formatRelativeTime(reply.createdAt)}</span>
                          </div>
                          <div className="text-xs text-content/80">
                            <AgentMarkdown text={reply.body} cwd={cwd} allowRemoteMedia />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center p-8 gap-2 text-center text-content/40 text-xs">
                <MessageSquare className="size-6 text-content/30" />
                <span>No hay comentarios ni revisiones en este Pull Request.</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChecksIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "loading":
      return <LoaderCircle className="size-4 animate-spin text-accent" />;
    case "fail":
    case "error":
      return <CircleX className="size-4 text-rose-400" />;
    case "pending":
      return <LoaderCircle className="size-4 animate-spin text-amber-400" />;
    case "pass":
      return <CheckCircle className="size-4 text-emerald-400" />;
    default:
      return <CircleDashed className="size-4 text-content/40" />;
  }
}

function CheckStateIcon({ state }: { state: string }) {
  switch (state) {
    case "pass":
      return <CheckCircle className="size-3 text-emerald-400 shrink-0" />;
    case "fail":
      return <CircleX className="size-3 text-rose-400 shrink-0" />;
    case "pending":
      return <LoaderCircle className="size-3 animate-spin text-amber-400 shrink-0" />;
    default:
      return <CircleDashed className="size-3 text-content/30 shrink-0" />;
  }
}
