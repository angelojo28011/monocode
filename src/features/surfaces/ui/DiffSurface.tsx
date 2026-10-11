import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDiff,
  RefreshCw,
  Search,
} from "../../../shared/ui/icons";
import {
  gitDiffFiles,
  gitFileDiff,
  basename,
  subscribeGitChanged,
  type GitChangedFile,
  type GitFileDiff,
} from "../../../platform/tauri/fs";
import { copyText } from "../../../platform/tauri/clipboard";
import { buildUnifiedFile, type UnifiedLine } from "../../source-control/model/unifiedDiff";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { MarkdownPreview } from "../../sessions/ui/AgentMarkdown";
import type { OpenFileFn } from "../../search/model/search";
import { diff } from "@codemirror/merge";

interface Props {
  cwd?: string;
  onOpenFile?: OpenFileFn;
}

export type ViewMode = "diff" | "original" | "current";

const STATUS_BADGE: Record<string, { label: string; bgClass: string; textClass: string }> = {
  modified: { label: "M", bgClass: "bg-amber-400/10 text-amber-400 border-amber-400/20", textClass: "text-amber-400" },
  added: { label: "A", bgClass: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20", textClass: "text-emerald-400" },
  untracked: { label: "U", bgClass: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20", textClass: "text-emerald-400" },
  deleted: { label: "D", bgClass: "bg-rose-400/10 text-rose-400 border-rose-400/20", textClass: "text-rose-400" },
};

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
      return "xml";
    default:
      return ext || "text";
  }
}

function tokenizeWords(text: string): string[] {
  return text.match(/([a-zA-Z0-9_]+|[^a-zA-Z0-9_\s]+|\s+)/g) || [text];
}

export type WordPart = { kind: "same" | "add" | "del"; text: string };

function wordDiff(oldStr: string, newStr: string): WordPart[] {
  if (oldStr === newStr) return [{ kind: "same", text: oldStr }];
  const wordsA = tokenizeWords(oldStr);
  const wordsB = tokenizeWords(newStr);
  const map = new Map<string, string>();
  const getChar = (w: string) => {
    let ch = map.get(w);
    if (!ch) {
      ch = String.fromCharCode(map.size + 65);
      map.set(w, ch);
    }
    return ch;
  };
  const encA = wordsA.map(getChar).join("");
  const encB = wordsB.map(getChar).join("");
  const changes = diff(encA, encB);
  const parts: WordPart[] = [];
  let curA = 0;
  for (const c of changes) {
    if (c.fromA > curA) {
      parts.push({ kind: "same", text: wordsA.slice(curA, c.fromA).join("") });
    }
    if (c.toA > c.fromA) {
      parts.push({ kind: "del", text: wordsA.slice(c.fromA, c.toA).join("") });
    }
    if (c.toB > c.fromB) {
      parts.push({ kind: "add", text: wordsB.slice(c.fromB, c.toB).join("") });
    }
    curA = c.toA;
  }
  if (curA < wordsA.length) {
    parts.push({ kind: "same", text: wordsA.slice(curA).join("") });
  }
  return parts;
}

export type DiffRow =
  | { type: "hunk"; text: string }
  | { type: "same"; oldNumber: number | null; newNumber: number | null; text: string }
  | {
      type: "modified";
      oldNumber: number | null;
      newNumber: number | null;
      oldText: string;
      newText: string;
      wordParts: WordPart[];
    }
  | { type: "add"; newNumber: number | null; text: string }
  | { type: "del"; oldNumber: number | null; text: string };

function buildDiffRows(lines: UnifiedLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === "hunk") {
      rows.push({ type: "hunk", text: line.text });
      i++;
      continue;
    }

    if (line.kind === "context") {
      rows.push({
        type: "same",
        oldNumber: line.oldNumber,
        newNumber: line.newNumber,
        text: line.text,
      });
      i++;
      continue;
    }

    const delLines: UnifiedLine[] = [];
    while (i < lines.length && lines[i].kind === "del") {
      delLines.push(lines[i]);
      i++;
    }

    const addLines: UnifiedLine[] = [];
    while (i < lines.length && lines[i].kind === "add") {
      addLines.push(lines[i]);
      i++;
    }

    const pairs = Math.min(delLines.length, addLines.length);

    for (let p = 0; p < pairs; p++) {
      const d = delLines[p];
      const a = addLines[p];
      rows.push({
        type: "modified",
        oldNumber: d.oldNumber,
        newNumber: a.newNumber,
        oldText: d.text,
        newText: a.text,
        wordParts: wordDiff(d.text, a.text),
      });
    }

    for (let d = pairs; d < delLines.length; d++) {
      rows.push({
        type: "del",
        oldNumber: delLines[d].oldNumber,
        text: delLines[d].text,
      });
    }

    for (let a = pairs; a < addLines.length; a++) {
      rows.push({
        type: "add",
        newNumber: addLines[a].newNumber,
        text: addLines[a].text,
      });
    }
  }

  return rows;
}

export function DiffSurface({ cwd, onOpenFile }: Props) {
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedRelative, setSelectedRelative] = useState<string | null>(null);

  // Active diff data
  const [activeDiff, setActiveDiff] = useState<GitFileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("");

  // Load changed files
  const loadChanges = useCallback(async () => {
    if (!cwd || cwd === "~") {
      setChangedFiles([]);
      return;
    }
    setLoadingList(true);
    try {
      const index = await gitDiffFiles(cwd);
      setChangedFiles(index.files || []);
      // Auto-select first file if available and none selected
      if (index.files?.length > 0) {
        setSelectedRelative((prev) => prev ?? index.files[0].relative);
      }
    } catch (err) {
      console.error("Error loading git diff files:", err);
      setChangedFiles([]);
    } finally {
      setLoadingList(false);
    }
  }, [cwd]);

  // Initial load on cwd change & subscribe to git changes
  useEffect(() => {
    setSelectedRelative(null);
    setActiveDiff(null);
    void loadChanges();
    const unsubscribe = subscribeGitChanged(loadChanges);
    return () => {
      unsubscribe();
    };
  }, [cwd, loadChanges]);

  // Load diff for selected file
  useEffect(() => {
    if (!cwd || !selectedRelative) {
      setActiveDiff(null);
      return;
    }

    let disposed = false;
    setLoadingDiff(true);

    void gitFileDiff(cwd, selectedRelative, "unstaged")
      .catch(() => gitFileDiff(cwd, selectedRelative, "staged"))
      .then((diff) => {
        if (disposed) return;
        setActiveDiff(diff);
      })
      .catch((err) => {
        if (disposed) return;
        console.error("Error loading file diff:", selectedRelative, err);
        setActiveDiff(null);
      })
      .finally(() => {
        if (!disposed) setLoadingDiff(false);
      });

    return () => {
      disposed = true;
    };
  }, [cwd, selectedRelative]);

  // Unified diff rows calculation with clean normalized line endings
  const diffRows = useMemo((): DiffRow[] => {
    if (!activeDiff || activeDiff.binary) return [];
    const original = (activeDiff.original || "").replace(/\r\n/g, "\n");
    const current = (activeDiff.current || "").replace(/\r\n/g, "\n");
    const unified = buildUnifiedFile(original, current);
    return buildDiffRows(unified.lines);
  }, [activeDiff]);

  // Copy active text
  const handleCopy = useCallback(async () => {
    if (!activeDiff) return;
    const textToCopy =
      viewMode === "original"
        ? activeDiff.original
        : viewMode === "current"
          ? activeDiff.current
          : diffRows
              .map((r) => {
                if (r.type === "same" || r.type === "hunk") return r.text;
                if (r.type === "add") return `+ ${r.text}`;
                if (r.type === "del") return `- ${r.text}`;
                return `- ${r.oldText}\n+ ${r.newText}`;
              })
              .join("\n");
    await copyText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeDiff, viewMode, diffRows]);

  // Filtered files list
  const filteredFiles = useMemo(() => {
    if (!filter) return changedFiles;
    const term = filter.toLowerCase();
    return changedFiles.filter((f) => f.relative.toLowerCase().includes(term) || f.path.toLowerCase().includes(term));
  }, [changedFiles, filter]);

  // Selected file details
  const selectedFile = useMemo(() => {
    return changedFiles.find((f) => f.relative === selectedRelative) || null;
  }, [changedFiles, selectedRelative]);

  const selectedFileName = selectedRelative ? basename(selectedRelative) : null;
  const statusInfo = selectedFile ? STATUS_BADGE[selectedFile.status] || STATUS_BADGE.modified : null;

  return (
    <div
      data-testid="diff-surface"
      className="relative z-10 flex h-full w-full min-h-0 overflow-hidden bg-transparent text-content select-none"
    >
      {/* Columna Izquierda: Visor del Diff o Código */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-stroke/60 bg-transparent">
        {selectedRelative && activeDiff ? (
          <div className="flex h-full w-full flex-col min-h-0">
            {/* Header del Visor */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-stroke/50 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileTypeIcon name={selectedFileName || "file"} isDir={false} size={16} />
                <h3 className="truncate font-mono text-[13.5px] font-semibold text-content tracking-tight">
                  {selectedFileName}
                </h3>
                {statusInfo ? (
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${statusInfo.bgClass}`}
                  >
                    {selectedFile?.status || "modified"}
                  </span>
                ) : null}
              </div>

              {/* Controles: Selector de modo (Diff / Original / Actual) */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center rounded-lg bg-white/[0.06] p-0.5 border border-stroke/40">
                  <button
                    type="button"
                    title="Ver diferencias línea por línea con palabras modificadas resaltadas"
                    onClick={() => setViewMode("diff")}
                    className={`rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      viewMode === "diff"
                        ? "bg-accent/25 text-accent font-semibold"
                        : "text-content/60 hover:text-content"
                    }`}
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    title="Ver código original completo"
                    onClick={() => setViewMode("original")}
                    className={`rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      viewMode === "original"
                        ? "bg-accent/25 text-accent font-semibold"
                        : "text-content/60 hover:text-content"
                    }`}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    title="Ver código actual resultante"
                    onClick={() => setViewMode("current")}
                    className={`rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      viewMode === "current"
                        ? "bg-accent/25 text-accent font-semibold"
                        : "text-content/60 hover:text-content"
                    }`}
                  >
                    Actual
                  </button>
                </div>

                {/* Botón Copiar */}
                <button
                  type="button"
                  title="Copiar contenido"
                  onClick={handleCopy}
                  className="flex size-7.5 items-center justify-center rounded-md text-content/60 transition-colors hover:bg-white/10 hover:text-content active:bg-white/15"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-400" strokeWidth={2} />
                  ) : (
                    <Copy className="size-3.5" strokeWidth={1.75} />
                  )}
                </button>

                {/* Botón Abrir en editor */}
                {onOpenFile && selectedFile ? (
                  <button
                    type="button"
                    title="Abrir en editor central de MonoCode"
                    onClick={() => onOpenFile(selectedFile.path)}
                    className="flex h-7.5 items-center gap-1.5 rounded-md bg-white/[0.08] px-2.5 text-[12px] font-medium text-content/85 transition-colors hover:bg-white/15 hover:text-content active:bg-white/20"
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    <span>Abrir en editor</span>
                  </button>
                ) : null}
              </div>
            </div>

            {/* Contenido principal: Visor de Diff o Código */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto p-3 select-text font-mono text-[12.5px] leading-relaxed">
              {loadingDiff ? (
                <div className="flex h-40 items-center justify-center text-xs text-content/40">
                  Cargando cambios…
                </div>
              ) : activeDiff.binary ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 p-6 text-center text-content/50">
                  <p className="text-xs font-medium">Archivo binario</p>
                  <p className="text-[11.5px] text-content/40">
                    No se puede generar un diff de texto para archivos binarios.
                  </p>
                </div>
              ) : viewMode === "diff" ? (
                /* Modo DIFF PAREADO: Líneas emparejadas con palabras modificadas resaltadas */
                <div className="flex flex-col w-full min-w-max">
                  {diffRows.length === 0 ? (
                    <p className="p-6 text-center text-xs text-content/40 font-sans">
                      No hay diferencias de texto en este archivo.
                    </p>
                  ) : (
                    diffRows.map((row, idx) => {
                      if (row.type === "hunk") {
                        return (
                          <div
                            key={idx}
                            className="flex items-center px-2 py-1 my-1 rounded bg-accent/10 text-accent/90 text-[11px] font-semibold tracking-wider select-none"
                          >
                            <span className="w-16 shrink-0 text-center text-accent/50">...</span>
                            <span className="flex-1">{row.text}</span>
                          </div>
                        );
                      }

                      if (row.type === "modified") {
                        // Número de referencia único para el cambio
                        const lineNum = row.newNumber ?? row.oldNumber ?? "";
                        return (
                          <div key={idx} className="flex flex-col">
                            {/* Renglón anterior (rojo) */}
                            <div className="flex items-start px-2 py-0.5 rounded-xs bg-rose-500/[0.12] text-rose-300 transition-colors">
                              <span className="w-10 shrink-0 text-right pr-2.5 text-[11px] text-content/30 select-none tabular-nums font-mono">
                                {lineNum}
                              </span>
                              <span className="w-4 shrink-0 font-bold select-none text-[12px] text-rose-400">-</span>
                              <span className="flex-1 whitespace-pre break-all">{row.oldText}</span>
                            </div>
                            {/* Renglón modificado (verde) */}
                            <div className="flex items-start px-2 py-0.5 rounded-xs bg-emerald-500/[0.12] text-emerald-300 transition-colors">
                              <span className="w-10 shrink-0 text-right pr-2.5 text-[11px] text-content/30 select-none tabular-nums font-mono">
                                {lineNum}
                              </span>
                              <span className="w-4 shrink-0 font-bold select-none text-[12px] text-emerald-400">+</span>
                              <span className="flex-1 whitespace-pre break-all">{row.newText}</span>
                            </div>
                          </div>
                        );
                      }

                      if (row.type === "add") {
                        return (
                          <div
                            key={idx}
                            className="flex items-start px-2 py-0.5 rounded-xs bg-emerald-500/[0.12] text-emerald-300"
                          >
                            <span className="w-10 shrink-0 text-right pr-2.5 text-[11px] text-content/30 select-none tabular-nums font-mono">
                              {row.newNumber ?? ""}
                            </span>
                            <span className="w-4 shrink-0 font-bold select-none text-[12px] text-emerald-400">+</span>
                            <span className="flex-1 whitespace-pre break-all">{row.text}</span>
                          </div>
                        );
                      }

                      if (row.type === "del") {
                        return (
                          <div
                            key={idx}
                            className="flex items-start px-2 py-0.5 rounded-xs bg-rose-500/[0.12] text-rose-300"
                          >
                            <span className="w-10 shrink-0 text-right pr-2.5 text-[11px] text-content/30 select-none tabular-nums font-mono">
                              {row.oldNumber ?? ""}
                            </span>
                            <span className="w-4 shrink-0 font-bold select-none text-[12px] text-rose-400">-</span>
                            <span className="flex-1 whitespace-pre break-all">{row.text}</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={idx}
                          className="flex items-start px-2 py-0.5 rounded-xs text-content/75 hover:bg-white/[0.03]"
                        >
                          <span className="w-10 shrink-0 text-right pr-2.5 text-[11px] text-content/30 select-none tabular-nums font-mono">
                            {row.newNumber ?? row.oldNumber ?? ""}
                          </span>
                          <span className="w-4 shrink-0 font-bold select-none text-[12px] opacity-20">&nbsp;</span>
                          <span className="flex-1 whitespace-pre break-all">{row.text}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                /* Modo Original o Actual */
                <div className="p-2">
                  <MarkdownPreview
                    text={
                      "````" +
                      fenceLanguageForPath(selectedRelative) +
                      "\n" +
                      (viewMode === "original" ? activeDiff.original : activeDiff.current) +
                      "\n````"
                    }
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    hardBreaks
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-content select-none">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/[0.04] text-content/40 border border-stroke/40">
              <FileDiff className="size-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1 max-w-xs">
              <h4 className="text-[13px] font-medium text-content/80">
                {changedFiles.length > 0
                  ? "Seleccioná un archivo para ver su diff"
                  : "Working tree limpio"}
              </h4>
              <p className="text-[11.5px] text-content/45 leading-relaxed">
                {changedFiles.length > 0
                  ? "Hacé clic en cualquier archivo de la lista para inspeccionar sus cambios de código línea por línea."
                  : "No hay archivos modificados en este proyecto. Todo el código coincide con el repositorio."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Columna Derecha: Lista de Archivos Modificados */}
      <div className="flex w-64 sm:w-72 md:w-80 shrink-0 flex-col bg-white/[0.02] border-l border-stroke/30">
        {/* Barra superior de herramientas y filtro */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-stroke/50 px-3 gap-2">
          {/* Input de filtro */}
          <div className="relative flex flex-1 min-w-0 items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-content/40" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar cambios..."
              className="h-7.5 w-full rounded-md bg-white/[0.06] pl-8 pr-3 text-[12px] text-content placeholder:text-content/35 border border-transparent focus:border-accent/40 focus:bg-white/[0.09] focus:outline-none transition-colors"
            />
          </div>

          {/* Botón recargar */}
          <button
            type="button"
            title="Recargar cambios"
            onClick={loadChanges}
            disabled={loadingList}
            className="flex size-7.5 items-center justify-center rounded-md text-content/50 hover:bg-white/10 hover:text-content transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`size-3.5 ${loadingList ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
        </div>

        {/* Sub-header con conteo de archivos y estadísticas */}
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-stroke/30 px-3 text-[11px] text-content/40">
          <span className="font-medium">
            {changedFiles.length} {changedFiles.length === 1 ? "archivo modificado" : "archivos modificados"}
          </span>
          {selectedFile && (selectedFile.additions || selectedFile.deletions) ? (
            <span className="flex items-center gap-1 font-mono font-medium">
              {selectedFile.additions ? (
                <span className="text-emerald-400">+{selectedFile.additions}</span>
              ) : null}
              {selectedFile.deletions ? (
                <span className="text-rose-400">-{selectedFile.deletions}</span>
              ) : null}
            </span>
          ) : null}
        </div>

        {/* Lista de archivos modificados */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 scrollbar-thin">
          {loadingList && changedFiles.length === 0 ? (
            <p className="p-4 text-center text-xs text-content/40">
              Buscando cambios…
            </p>
          ) : filteredFiles.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center p-4 text-center text-content/40">
              <p className="text-xs">Sin modificaciones pendientes</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filteredFiles.map((file) => {
                const name = basename(file.relative);
                const isSelected = selectedRelative === file.relative;
                const status = STATUS_BADGE[file.status] || STATUS_BADGE.modified;

                return (
                  <button
                    key={file.relative}
                    type="button"
                    onClick={() => setSelectedRelative(file.relative)}
                    className={`group flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors ${
                      isSelected
                        ? "bg-white/[0.12] text-content font-medium shadow-xs"
                        : "text-content/80 hover:bg-white/[0.06] hover:text-content active:bg-white/10"
                    }`}
                  >
                    <FileTypeIcon name={name} isDir={false} size={15} />
                    <span className="truncate flex-1 tracking-tight" title={file.relative}>
                      {name}
                    </span>

                    {/* Stats + / - */}
                    {file.additions || file.deletions ? (
                      <span className="flex items-center gap-1 font-mono text-[11px] font-semibold tabular-nums">
                        {file.additions ? (
                          <span className="text-emerald-400">+{file.additions}</span>
                        ) : null}
                        {file.deletions ? (
                          <span className="text-rose-400">-{file.deletions}</span>
                        ) : null}
                      </span>
                    ) : null}

                    {/* Badge de status */}
                    <span
                      className={`rounded px-1 text-[10px] font-bold uppercase ${status.textClass}`}
                      title={`Estado: ${file.status}`}
                    >
                      {status.label}
                    </span>

                    <ChevronRight
                      className={`size-3 text-content/30 transition-transform ${
                        isSelected ? "text-content/70 translate-x-0.5" : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
