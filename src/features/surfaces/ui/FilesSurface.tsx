import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDiff,
  FoldVertical,
  RefreshCw,
  Search,
  X,
} from "../../../shared/ui/icons";
import {
  listDir,
  readTextFile,
  basename,
  type FsEntry,
} from "../../../platform/tauri/fs";
import { copyText } from "../../../platform/tauri/clipboard";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { MarkdownPreview } from "../../sessions/ui/AgentMarkdown";
import { useGitFileStatuses } from "../../source-control/hooks/useGitFileStatuses";
import type { OpenFileFn } from "../../search/model/search";

interface Props {
  cwd?: string;
  onOpenFile?: OpenFileFn;
}

const GIT_STATUS_STYLE: Record<string, { label: string; textClass: string; bgClass: string }> = {
  modified: { label: "M", textClass: "text-amber-400", bgClass: "bg-amber-400/10 text-amber-400" },
  added: { label: "A", textClass: "text-emerald-400", bgClass: "bg-emerald-400/10 text-emerald-400" },
  untracked: { label: "U", textClass: "text-emerald-400", bgClass: "bg-emerald-400/10 text-emerald-400" },
  deleted: { label: "D", textClass: "text-rose-400", bgClass: "bg-rose-400/10 text-rose-400" },
};

function isMarkdownPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return [".md", ".mdx", ".markdown"].includes(ext);
}

function fenceLanguageForPath(path: string): string {
  const name = basename(path).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "rs":
      return "rust";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "py":
      return "python";
    case "sql":
      return "sql";
    case "xml":
    case "svg":
      return "xml";
    default:
      return ext || "text";
  }
}

export function FilesSurface({ cwd, onOpenFile }: Props) {
  const [filter, setFilter] = useState("");
  const [onlyModified, setOnlyModified] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [entriesByDir, setEntriesByDir] = useState<Map<string, FsEntry[]>>(() => new Map());

  // Selected file inspector state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Git statuses for active cwd
  const gitStatuses = useGitFileStatuses(cwd || "", Boolean(cwd));

  // Load directory entries
  const loadDirectory = useCallback(async (dirPath: string) => {
    try {
      const items = await listDir(dirPath);
      setEntriesByDir((prev) => {
        const next = new Map(prev);
        next.set(dirPath, items);
        return next;
      });
    } catch (err) {
      console.error("Error listing directory:", dirPath, err);
    }
  }, []);

  // When cwd changes, reload root
  useEffect(() => {
    if (!cwd) return;
    setEntriesByDir(new Map());
    setExpandedDirs(new Set([cwd]));
    setSelectedFile(null);
    setFileContent(null);
    setContentError(null);
    void loadDirectory(cwd);
  }, [cwd, loadDirectory]);

  // Read selected file content
  const handleSelectFile = useCallback(
    async (path: string) => {
      setSelectedFile(path);
      setLoadingContent(true);
      setContentError(null);
      setCopied(false);

      try {
        const text = await readTextFile(path);
        setFileContent(text);
      } catch (err) {
        setFileContent(null);
        setContentError(
          typeof err === "string" ? err : "No se puede leer este archivo como texto plano.",
        );
      } finally {
        setLoadingContent(false);
      }
    },
    [],
  );

  // Toggle directory expansion
  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!entriesByDir.has(dirPath)) {
            void loadDirectory(dirPath);
          }
        }
        return next;
      });
    },
    [entriesByDir, loadDirectory],
  );

  // Collapse all
  const handleCollapseAll = useCallback(() => {
    if (!cwd) return;
    setExpandedDirs(new Set([cwd]));
  }, [cwd]);

  // Refresh
  const handleRefresh = useCallback(() => {
    if (!cwd) return;
    setEntriesByDir(new Map());
    void loadDirectory(cwd);
    if (selectedFile) {
      void handleSelectFile(selectedFile);
    }
  }, [cwd, loadDirectory, selectedFile, handleSelectFile]);

  // Copy file content
  const handleCopyContent = useCallback(async () => {
    if (!fileContent) return;
    await copyText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fileContent]);

  // Open file in main editor
  const handleOpenInEditor = useCallback(() => {
    if (selectedFile && onOpenFile) {
      onOpenFile(selectedFile);
    }
  }, [selectedFile, onOpenFile]);

  // Determine git status of a file or dir
  const getGitStatus = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        return gitStatuses.dirs.get(path);
      }
      return gitStatuses.files.get(path);
    },
    [gitStatuses],
  );

  // Count modified files
  const modifiedCount = useMemo(() => {
    return gitStatuses.files.size;
  }, [gitStatuses]);

  // Recursive directory tree renderer
  const renderTree = useCallback(
    (dirPath: string, depth = 0): React.ReactNode => {
      const items = entriesByDir.get(dirPath) ?? [];

      const filtered = items.filter((item) => {
        // Exclude internal directories like .git unless searching
        if (!filter && (item.name === ".git" || item.name === ".atl" || item.name === "node_modules")) {
          // If onlyModified is true and there is a change inside, show; else skip
          if (!onlyModified) return false;
        }

        if (onlyModified) {
          const status = getGitStatus(item.path, item.isDir);
          if (!status) return false;
        }

        if (filter) {
          const term = filter.toLowerCase();
          const matchName = item.name.toLowerCase().includes(term);
          if (item.isDir) {
            // Include dir if name matches or has modified files
            return matchName || Boolean(getGitStatus(item.path, true));
          }
          return matchName;
        }

        return true;
      });

      return (
        <div key={dirPath} className="flex flex-col">
          {filtered.map((item) => {
            const isDir = item.isDir;
            const isExpanded = expandedDirs.has(item.path);
            const status = getGitStatus(item.path, isDir);
            const statusInfo = status ? GIT_STATUS_STYLE[status] : null;
            const isSelected = selectedFile === item.path;

            if (isDir) {
              return (
                <div key={item.path} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleDir(item.path)}
                    style={{ paddingLeft: `${depth * 14 + 10}px` }}
                    className="group flex h-7.5 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-content/75 transition-colors hover:bg-white/[0.06] hover:text-content active:bg-white/10"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-content/40 group-hover:text-content/70">
                      {isExpanded ? (
                        <ChevronDown className="size-3.5" strokeWidth={2} />
                      ) : (
                        <ChevronRight className="size-3.5" strokeWidth={2} />
                      )}
                    </span>
                    <FileTypeIcon name={item.name} isDir={true} isOpen={isExpanded} size={15} />
                    <span className="truncate font-normal tracking-tight">{item.name}</span>
                    {statusInfo ? (
                      <span
                        className={`ml-auto text-[11px] font-semibold ${statusInfo.textClass}`}
                        title={`Git: ${status}`}
                      >
                        {statusInfo.label}
                      </span>
                    ) : null}
                  </button>
                  {isExpanded ? renderTree(item.path, depth + 1) : null}
                </div>
              );
            }

            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handleSelectFile(item.path)}
                onDoubleClick={() => onOpenFile?.(item.path)}
                style={{ paddingLeft: `${depth * 14 + 26}px` }}
                className={`group flex h-7.5 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors ${
                  isSelected
                    ? "bg-white/[0.12] text-content font-medium shadow-xs"
                    : "text-content/80 hover:bg-white/[0.06] hover:text-content active:bg-white/10"
                }`}
              >
                <FileTypeIcon name={item.name} isDir={false} size={15} />
                <span className="truncate font-normal tracking-tight">{item.name}</span>
                {statusInfo ? (
                  <span
                    className={`ml-auto text-[11px] font-semibold ${statusInfo.textClass}`}
                    title={`Git: ${status}`}
                  >
                    {statusInfo.label}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    },
    [entriesByDir, cwd, filter, onlyModified, getGitStatus, expandedDirs, selectedFile, toggleDir, handleSelectFile, onOpenFile],
  );

  // Inspector content preparation
  const inspectorMarkdown = useMemo(() => {
    if (!selectedFile || fileContent === null) return "";
    if (isMarkdownPath(selectedFile)) {
      return fileContent;
    }
    const lang = fenceLanguageForPath(selectedFile);
    // Cap very large files to 2000 lines to preserve performance
    const lines = fileContent.split("\n");
    const isCapped = lines.length > 2000;
    const displayBody = isCapped ? lines.slice(0, 2000).join("\n") + "\n\n// ... [Archivo truncado en preview: abrí en editor para ver completo]" : fileContent;
    return "````" + lang + "\n" + displayBody + "\n````";
  }, [selectedFile, fileContent]);

  const selectedFileName = selectedFile ? basename(selectedFile) : null;
  const selectedFileStatus = selectedFile ? getGitStatus(selectedFile, false) : null;
  const selectedStatusInfo = selectedFileStatus ? GIT_STATUS_STYLE[selectedFileStatus] : null;

  return (
    <div
      data-testid="files-surface"
      className="relative z-10 flex h-full w-full min-h-0 overflow-hidden bg-transparent text-content select-none"
    >
      {/* Columna Izquierda: Visor / Inspector del archivo seleccionado */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-stroke/60 bg-transparent">
        {selectedFile ? (
          <div className="flex h-full w-full flex-col min-h-0">
            {/* Header del Inspector */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-stroke/50 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileTypeIcon name={selectedFileName || "file"} isDir={false} size={16} />
                <h3 className="truncate font-mono text-[13.5px] font-semibold text-content tracking-tight">
                  {selectedFileName}
                </h3>
                {selectedStatusInfo ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${selectedStatusInfo.bgClass}`}
                  >
                    {selectedFileStatus}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Botón Copiar */}
                <button
                  type="button"
                  title="Copiar contenido"
                  onClick={handleCopyContent}
                  disabled={!fileContent}
                  className="flex size-7.5 items-center justify-center rounded-md text-content/60 transition-colors hover:bg-white/10 hover:text-content active:bg-white/15 disabled:opacity-40"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-400" strokeWidth={2} />
                  ) : (
                    <Copy className="size-3.5" strokeWidth={1.75} />
                  )}
                </button>

                {/* Botón Abrir en editor principal */}
                {onOpenFile ? (
                  <button
                    type="button"
                    title="Abrir en editor central de MonoCode"
                    onClick={handleOpenInEditor}
                    className="flex h-7.5 items-center gap-1.5 rounded-md bg-white/[0.08] px-2.5 text-[12px] font-medium text-content/85 transition-colors hover:bg-white/15 hover:text-content active:bg-white/20"
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    <span>Abrir en editor</span>
                  </button>
                ) : null}

                {/* Botón cerrar preview */}
                <button
                  type="button"
                  title="Cerrar vista previa"
                  onClick={() => setSelectedFile(null)}
                  className="flex size-7.5 items-center justify-center rounded-md text-content/50 transition-colors hover:bg-white/10 hover:text-content"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {/* Contenido del archivo inspeccionado */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto p-4 select-text">
              {loadingContent ? (
                <div className="flex h-40 items-center justify-center text-xs text-content/40">
                  Cargando contenido…
                </div>
              ) : contentError ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 p-6 text-center">
                  <p className="text-xs text-rose-400/90 font-medium">{contentError}</p>
                  <p className="text-[11.5px] text-content/50 max-w-xs">
                    Los archivos binarios o sin codificación UTF-8 válida no se pueden inspeccionar como código.
                  </p>
                </div>
              ) : fileContent !== null ? (
                <div className="min-w-0 max-w-full font-sans text-sm">
                  <MarkdownPreview
                    text={inspectorMarkdown}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    hardBreaks
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-content select-none">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/[0.04] text-content/40 border border-stroke/40">
              <Search className="size-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1 max-w-xs">
              <h4 className="text-[13px] font-medium text-content/80">
                Seleccioná un archivo
              </h4>
              <p className="text-[11.5px] text-content/45 leading-relaxed">
                Hacé clic en cualquier archivo de la lista para revisar su código, configuración o documentación de inmediato.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Columna Derecha: Explorador de Archivos y Filtro */}
      <div className="flex w-64 sm:w-72 md:w-80 shrink-0 flex-col bg-white/[0.02] border-l border-stroke/30">
        {/* Barra superior de herramientas y filtro */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-stroke/50 px-3 gap-2">
          {/* Input de filtro de archivos */}
          <div className="relative flex flex-1 min-w-0 items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-content/40" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar archivos..."
              className="h-7.5 w-full rounded-md bg-white/[0.06] pl-8 pr-7 text-[12px] text-content placeholder:text-content/35 border border-transparent focus:border-accent/40 focus:bg-white/[0.09] focus:outline-none transition-colors"
            />
            {filter ? (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-1.5 flex size-5 items-center justify-center rounded text-content/40 hover:text-content"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            ) : null}
          </div>

          {/* Acciones de la lista */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Filtro de solo modificados */}
            <button
              type="button"
              title={onlyModified ? "Mostrar todos los archivos" : "Mostrar solo modificados (Git)"}
              onClick={() => setOnlyModified((prev) => !prev)}
              className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                onlyModified
                  ? "bg-amber-400/20 text-amber-400 font-semibold"
                  : "text-content/50 hover:bg-white/10 hover:text-content"
              }`}
            >
              <FileDiff className="size-3.5" strokeWidth={1.75} />
            </button>

            {/* Colapsar todo */}
            <button
              type="button"
              title="Colapsar carpetas"
              onClick={handleCollapseAll}
              className="flex size-7 items-center justify-center rounded-md text-content/50 hover:bg-white/10 hover:text-content transition-colors"
            >
              <FoldVertical className="size-3.5" strokeWidth={1.75} />
            </button>

            {/* Recargar */}
            <button
              type="button"
              title="Recargar árbol"
              onClick={handleRefresh}
              className="flex size-7 items-center justify-center rounded-md text-content/50 hover:bg-white/10 hover:text-content transition-colors"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Sub-header con nombre de proyecto y estado */}
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-stroke/30 px-3 text-[11px] text-content/40">
          <span className="truncate font-medium">{cwd ? basename(cwd) : "Sin proyecto"}</span>
          {modifiedCount > 0 ? (
            <span className="text-amber-400/90 font-medium">
              {modifiedCount} {modifiedCount === 1 ? "modificado" : "modificados"}
            </span>
          ) : null}
        </div>

        {/* Árbol de archivos */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 scrollbar-thin">
          {cwd ? (
            renderTree(cwd)
          ) : (
            <p className="p-4 text-center text-xs text-content/40">
              No hay una carpeta de proyecto activa.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
