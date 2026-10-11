import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gitBranches } from "../../../platform/tauri/fs";
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
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { InboxPrDiff } from "../../inbox/ui/InboxPrDiff";
import {
  CheckCircle,
  ChevronDown,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
} from "../../../shared/ui/icons";

interface Props {
  cwd?: string;
  onOpenFile?: (path: string) => void;
}

type TabMode = "overview" | "files" | "discussion";

export function PrSurface({ cwd, onOpenFile }: Props) {
  const [repo, setRepo] = useState<string | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [openPrs, setOpenPrs] = useState<GithubWorkItem[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabMode>("overview");
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(null);
  const [thread, setThread] = useState<GithubWorkItemThread | null>(null);
  const [diff, setDiff] = useState<GithubPrDiff | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [focusedFilePath, setFocusedFilePath] = useState<string | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  // Carga inicial de repositorio, rama actual y lista de PRs abiertos
  const loadPrList = useCallback(async () => {
    if (!cwd) {
      setRepo(null);
      setCurrentBranch(null);
      setOpenPrs([]);
      setSelectedPrNumber(null);
      return;
    }

    setLoadingList(true);
    setListError(null);

    try {
      const [repoName, branchesInfo] = await Promise.all([
        githubRepo(cwd).catch(() => null),
        gitBranches(cwd).catch(() => null),
      ]);

      setRepo(repoName);
      const branch = branchesInfo?.current ?? null;
      setCurrentBranch(branch);

      if (!repoName) {
        setOpenPrs([]);
        setSelectedPrNumber(null);
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

      if (prs.length > 0) {
        // Si hay una rama actual, intentar emparejar con el PR de esa rama
        let matchedNumber: number | null = null;
        if (branch) {
          // Primero revisar si algún PR tiene título o número relevante,
          // o cargar detalles del primer PR
          for (const item of prs) {
            try {
              const itemDetails = await githubWorkItemDetails(cwd, repoName, "pr", item.number, {
                maxAgeMs: 60_000,
              });
              if (itemDetails.headRefName === branch) {
                matchedNumber = item.number;
                break;
              }
            } catch {
              // Continuar búsqueda
            }
          }
        }

        // Si no hubo coincidencia exacta con la rama, usar el primer PR abierto
        setSelectedPrNumber(matchedNumber ?? prs[0]!.number);
      } else {
        setSelectedPrNumber(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setListError(msg);
      setOpenPrs([]);
      setSelectedPrNumber(null);
    } finally {
      setLoadingList(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPrList();
  }, [loadPrList, revision]);

  // Objeto de PR actualmente seleccionado en la lista
  const activePr = openPrs.find((p) => p.number === selectedPrNumber) ?? null;

  // Cargar detalles completos (descripción, thread, diff) del PR seleccionado
  useEffect(() => {
    if (!cwd || !repo || !selectedPrNumber) {
      setDetails(null);
      setThread(null);
      setDiff(null);
      return;
    }

    let cancelled = false;
    setLoadingDetails(true);

    void Promise.allSettled([
      githubWorkItemDetails(cwd, repo, "pr", selectedPrNumber),
      githubWorkItemThread(cwd, repo, "pr", selectedPrNumber),
      githubPrDiff(cwd, repo, selectedPrNumber),
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
  }, [cwd, repo, selectedPrNumber, revision]);

  // Verificación de checks de CI
  const checksView = useGithubPrChecks({
    cwd: cwd ?? "",
    repo: repo ?? "",
    number: selectedPrNumber ?? 0,
    enabled: Boolean(cwd && repo && selectedPrNumber),
    open: activePr?.state === "open",
    revision,
  });

  const overallChecks = summarizePrChecks({
    loading: checksView.loading,
    error: checksView.error,
    checks: checksView.checks?.checks ?? null,
  });

  const handleOpenBrowser = () => {
    if (activePr?.url) {
      void openUrl(activePr.url);
    } else if (repo) {
      void openUrl(`https://github.com/${repo}/pulls`);
    }
  };

  const handleRefresh = () => {
    setRevision((prev) => prev + 1);
    checksView.refresh();
  };

  // Estado de carga inicial
  if (loadingList && openPrs.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-content select-none">
        <LoaderCircle className="size-6 animate-spin text-accent" />
        <p className="text-xs text-content/60">Buscando Pull Requests en GitHub...</p>
      </div>
    );
  }

  // Error o sin repositorio GitHub
  if (listError && openPrs.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center text-content select-none">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.04] text-content/60 border border-stroke">
          <GitPullRequest className="size-6" strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1 max-w-sm">
          <h3 className="text-sm font-semibold text-content">Pull Requests</h3>
          <p className="text-xs text-content/50">{listError}</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3.5 py-1.5 text-xs font-medium text-content hover:bg-white/[0.12] transition-colors"
        >
          <RefreshCw className="size-3.5" />
          <span>Reintentar</span>
        </button>
      </div>
    );
  }

  // Sin PRs abiertos
  if (openPrs.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center text-content select-none">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.04] text-content/40 border border-stroke">
          <GitPullRequest className="size-7" strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1 max-w-sm">
          <h3 className="text-sm font-semibold text-content">Sin Pull Requests abiertos</h3>
          <p className="text-xs text-content/50">
            No se encontraron Pull Requests abiertos en el repositorio{" "}
            {repo ? <span className="font-mono text-content/80">{repo}</span> : ""}.
          </p>
          {currentBranch ? (
            <div className="mt-2 inline-flex items-center justify-center gap-1.5 text-[11px] text-content/60 bg-white/[0.04] py-1 px-2.5 rounded-md self-center font-mono border border-stroke/40">
              <GitBranch className="size-3 text-accent" />
              <span>{currentBranch}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-content hover:bg-white/[0.12] transition-colors"
          >
            <RefreshCw className="size-3.5" />
            <span>Recargar</span>
          </button>
          {repo ? (
            <button
              type="button"
              onClick={handleOpenBrowser}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-content hover:bg-accent/90 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              <span>Ver en GitHub</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      data-surface="pr"
      className="flex h-full w-full flex-col bg-transparent text-content overflow-hidden select-text"
    >
      {/* Cabecera del Pull Request */}
      <header className="flex flex-col border-b border-stroke/40 bg-white/[0.02] px-3 py-2.5 gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Estado del PR */}
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                activePr?.draft
                  ? "bg-white/[0.06] text-content/60 border-stroke/50"
                  : activePr?.state === "open"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-purple-500/15 text-purple-300 border-purple-500/30"
              }`}
            >
              {activePr?.draft ? (
                <GitPullRequestDraft className="size-3" />
              ) : activePr?.state === "open" ? (
                <GitPullRequest className="size-3 text-emerald-400" />
              ) : (
                <GitMerge className="size-3 text-purple-400" />
              )}
              <span className="capitalize">{activePr?.draft ? "Borrador" : activePr?.state ?? "Open"}</span>
            </div>

            {/* Selector de PRs si hay más de uno */}
            {openPrs.length > 1 ? (
              <div className="relative inline-block">
                <select
                  value={selectedPrNumber ?? ""}
                  onChange={(e) => setSelectedPrNumber(Number(e.target.value))}
                  className="appearance-none bg-white/[0.06] hover:bg-white/[0.10] text-content text-xs font-medium rounded-md pl-2 pr-6 py-1 border border-stroke/50 focus:outline-none focus:border-accent cursor-pointer"
                >
                  {openPrs.map((pr) => (
                    <option key={pr.number} value={pr.number} className="bg-background-base text-content">
                      #{pr.number}: {pr.title.slice(0, 36)}
                      {pr.title.length > 36 ? "…" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3 text-content/50 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            ) : (
              <span className="text-xs font-mono font-medium text-content/50">#{activePr?.number}</span>
            )}
          </div>

          {/* Acciones de cabecera */}
          <div className="flex items-center gap-1 shrink-0">
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
            {activePr?.title ?? "Pull Request"}
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

            {activePr?.updatedAt ? <span>Actualizado {formatRelativeTime(activePr.updatedAt)}</span> : null}
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

            {/* Labels si existen */}
            {activePr?.labels && activePr.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {activePr.labels.map((label, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] text-content/80 border border-stroke/40"
                    style={label.color ? { borderColor: `#${label.color}40`, color: `#${label.color}` } : undefined}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            ) : null}

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
                {/* Resumen de cambios */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-stroke/30 bg-white/[0.02] text-xs">
                  <span className="text-content/70 font-medium">
                    {diff.files.length} archivo{diff.files.length === 1 ? "" : "s"} modificado{diff.files.length === 1 ? "" : "s"}
                  </span>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-emerald-400 font-semibold">+{diff.additions}</span>
                    <span className="text-rose-400 font-semibold">-{diff.deletions}</span>
                  </div>
                </div>

                {/* Lista rápida de archivos tocados */}
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

                {/* Visor de Diff unificado */}
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

                  {/* Respuestas anidadas si existen */}
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
