"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  Folder,
  FolderOpen,
  GripVertical,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EditorStatusNotice,
  type EditorStatusNoticeData,
} from "@/components/editor-status-notice";
import { Spinner } from "@/components/ui/spinner";
import { VehicleConfigEditor } from "@/components/vehicle-config-editor";
import { getErrorErrors, getErrorMessage } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import {
  useCreateVehicleConfigMutation,
  useUpdateVehicleConfigMutation,
  useValidateVehicleConfigMutation,
  useVehicleConfigQuery,
  useVehicleConfigsQuery,
  type VehicleConfigDocument,
  type VehicleConfigListItem,
  type VehicleConfigValidationError,
} from "@/lib/query-hooks";
import { cn } from "@/lib/utils";

const EXPLORER_WIDTH_STORAGE_KEY = "vehicle-config-explorer-width";
const EXPLORER_EXPANDED_STORAGE_KEY = "vehicle-config-expanded-folders";
const EXPLORER_MIN_WIDTH = 240;
const EXPLORER_MAX_WIDTH = 520;
const EDITOR_MIN_WIDTH = 420;

type VehicleConfigTreeNode = VehicleConfigTreeDirectoryNode | VehicleConfigTreeFileNode;

type VehicleConfigTreeDirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: VehicleConfigTreeNode[];
};

type VehicleConfigTreeFileNode = {
  type: "file";
  path: string;
  item: VehicleConfigListItem;
};

function formatValidationErrorDetail(error: VehicleConfigValidationError): string {
  const parts: string[] = [];
  if (error.loc.length > 0) parts.push(error.loc.join(" > "));
  parts.push(error.message);
  if (error.type) parts.push(`(${error.type})`);
  return parts.join(" ");
}

function clampExplorerWidth(nextWidth: number, containerWidth: number): number {
  const maxWidth = Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, containerWidth - EDITOR_MIN_WIDTH));
  return Math.min(Math.max(nextWidth, EXPLORER_MIN_WIDTH), maxWidth);
}

function ancestorFolderPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function buildVehicleConfigTree(items: VehicleConfigListItem[]): VehicleConfigTreeDirectoryNode {
  const root: VehicleConfigTreeDirectoryNode = {
    type: "directory",
    name: "VEHICLE_CONFIGURATION_PATH",
    path: "",
    children: [],
  };

  for (const item of items) {
    const parts = item.path.split("/").filter(Boolean);
    let current = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      const path = parts.slice(0, index + 1).join("/");
      let next = current.children.find(
        (child): child is VehicleConfigTreeDirectoryNode => child.type === "directory" && child.path === path
      );
      if (!next) {
        next = { type: "directory", name, path, children: [] };
        current.children.push(next);
      }
      current = next;
    }

    current.children.push({
      type: "file",
      path: item.path,
      item,
    });
  }

  function sortTree(node: VehicleConfigTreeDirectoryNode) {
    node.children.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      const leftName = left.type === "directory" ? left.name : left.item.filename;
      const rightName = right.type === "directory" ? right.name : right.item.filename;
      return leftName.localeCompare(rightName);
    });

    for (const child of node.children) {
      if (child.type === "directory") sortTree(child);
    }
  }

  sortTree(root);
  return root;
}

function defaultExpandedFolders(items: VehicleConfigListItem[], selectedPath: string): string[] {
  const expanded = new Set<string>();
  for (const item of items) {
    const firstFolder = item.path.split("/").filter(Boolean)[0];
    if (firstFolder) expanded.add(firstFolder);
  }
  for (const folder of ancestorFolderPaths(selectedPath)) expanded.add(folder);
  return Array.from(expanded);
}

type ExplorerNodeProps = {
  node: VehicleConfigTreeNode;
  depth: number;
  selectedPath: string;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectPath: (path: string) => void;
};

function ExplorerNode({
  node,
  depth,
  selectedPath,
  expandedFolders,
  onToggleFolder,
  onSelectPath,
}: ExplorerNodeProps) {
  const paddingLeft = 12 + depth * 14;

  if (node.type === "directory") {
    const isOpen = expandedFolders.has(node.path);
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium tracking-[0.12em] uppercase transition-colors"
          style={{ paddingLeft }}
        >
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {isOpen ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
          <span className="truncate">{node.name}</span>
        </button>

        {isOpen ? (
          <div className="space-y-1">
            {node.children.map((child) => (
              <ExplorerNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectPath={onSelectPath}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const item = node.item;
  const isSelected = selectedPath === item.path;

  return (
    <button
      type="button"
      onClick={() => onSelectPath(item.path)}
      data-testid="vehicle-config-file-button"
      data-path={item.path}
      title={item.path}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/70",
        isSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground"
      )}
      style={{ paddingLeft }}
    >
      {item.format === "json" ? (
        <FileJson2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <FileCode2 className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={cn("block truncate font-medium", isSelected ? "text-foreground" : "text-foreground/90")}>
            {item.name || item.filename}
          </span>
          <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-[10px] uppercase">{item.format}</span>
        </span>
        <span className="block truncate font-mono text-[10px] opacity-80">{item.path}</span>
      </span>
    </button>
  );
}

type EditorWorkspaceProps = {
  document: VehicleConfigDocument | undefined;
  initialPath: string;
  selectedPath: string;
  isLoadingSelectedPath: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSelectPath: (path: string) => void;
  onRefreshList: () => Promise<unknown>;
  onRefreshDocument: () => Promise<unknown>;
};

function VehicleConfigEditorWorkspace({
  document,
  initialPath,
  selectedPath,
  isLoadingSelectedPath,
  onDirtyChange,
  onSelectPath,
  onRefreshList,
  onRefreshDocument,
}: EditorWorkspaceProps) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(document?.content ?? "");
  const [notice, setNotice] = useState<EditorStatusNoticeData | null>(null);
  const [parsedSummary, setParsedSummary] = useState(document?.parsed ?? null);

  const validateMutation = useValidateVehicleConfigMutation();
  const createMutation = useCreateVehicleConfigMutation();
  const updateMutation = useUpdateVehicleConfigMutation();

  const loadedPath = document?.path ?? initialPath;
  const draftPath = loadedPath;
  const loadedContent = document?.content ?? "";
  const trimmedDraftPath = draftPath.trim();
  const displayedPath = isLoadingSelectedPath ? selectedPath : draftPath;
  const displayedParsedSummary = isLoadingSelectedPath ? null : parsedSummary;
  const isDirty = draftPath !== loadedPath || content !== loadedContent;
  const displayName =
    displayedParsedSummary?.name ||
    document?.path.split("/").at(-1) ||
    trimmedDraftPath.split("/").at(-1) ||
    "Configuration";

  function showNotice(nextNotice: Omit<EditorStatusNoticeData, "id">) {
    setNotice({
      id: Date.now() + Math.floor(Math.random() * 1000),
      dismissible: true,
      ...nextNotice,
    });
  }

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function handleValidate() {
    if (trimmedDraftPath.length === 0 || content.trim().length === 0) return;
    setNotice(null);

    try {
      const result = await validateMutation.mutateAsync({
        path: trimmedDraftPath,
        content,
      });
      setParsedSummary(result.parsed ?? null);
      if (!result.valid) {
        showNotice({
          variant: "error",
          title: "Validation Failed",
          message: "Validation failed.",
          details: result.errors.map(formatValidationErrorDetail),
          autoHideMs: null,
        });
        return;
      }
      showNotice({
        variant: "success",
        title: "Validation Passed",
        message: "Vehicle configuration is valid.",
        autoHideMs: 4000,
      });
    } catch (error) {
      const errors = getErrorErrors<VehicleConfigValidationError>(error);
      showNotice({
        variant: "error",
        title: "Validation Failed",
        message: getErrorMessage(error, "Validation failed"),
        details: errors.map(formatValidationErrorDetail),
        autoHideMs: null,
      });
    }
  }

  async function handleSave() {
    if (trimmedDraftPath.length === 0 || content.trim().length === 0) return;
    setNotice(null);

    try {
      if (initialPath && trimmedDraftPath === initialPath) {
        const result = await updateMutation.mutateAsync({ path: trimmedDraftPath, content });
        await Promise.all([
          onRefreshList(),
          onRefreshDocument(),
          queryClient.invalidateQueries({ queryKey: queryKeys.vehicleConfig(result.path) }),
        ]);
        setParsedSummary(result.parsed);
        showNotice({
          variant: "success",
          title: "Save Succeeded",
          message: `Saved ${result.path}.`,
          autoHideMs: 4000,
        });
        return;
      }

      const result = await createMutation.mutateAsync({ path: trimmedDraftPath, content });
      await onRefreshList();
      await queryClient.invalidateQueries({ queryKey: queryKeys.vehicleConfig(result.path) });
      onSelectPath(result.path);
      setParsedSummary(result.parsed);
      showNotice({
        variant: "success",
        title: "Create Succeeded",
        message: `Created ${result.path}.`,
        autoHideMs: 4000,
      });
    } catch (error) {
      const errors = getErrorErrors<VehicleConfigValidationError>(error);
      showNotice({
        variant: "error",
        title: initialPath ? "Save Failed" : "Create Failed",
        message: getErrorMessage(error, initialPath ? "Save failed" : "Create failed"),
        details: errors.map(formatValidationErrorDetail),
        autoHideMs: null,
      });
    }
  }

  return (
    <section className="bg-background/95 border-border/70 relative flex h-full min-h-0 min-w-0 flex-col rounded-xl border shadow-xs backdrop-blur">
      {notice ? <EditorStatusNotice key={notice.id} notice={notice} onClear={() => setNotice(null)} /> : null}
      <div className="border-border/70 border-b px-4 py-3">
        <div className="min-w-0 space-y-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {draftPath.trim().toLowerCase().endsWith(".json") ? (
                <FileJson2 className="text-muted-foreground size-4 shrink-0" />
              ) : (
                <FileCode2 className="text-muted-foreground size-4 shrink-0" />
              )}
              <h1 className="truncate text-base font-semibold tracking-tight">{displayName}</h1>
            </div>
            <div
              id="vehicle-config-path"
              data-testid="vehicle-config-path-display"
              title={displayedPath}
              className="text-muted-foreground mt-1 truncate font-mono text-xs"
            >
              {displayedPath}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleValidate}
                disabled={
                  isLoadingSelectedPath ||
                  validateMutation.isPending ||
                  trimmedDraftPath.length === 0 ||
                  content.trim().length === 0
                }
              >
                Validate
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  isLoadingSelectedPath ||
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  trimmedDraftPath.length === 0 ||
                  content.trim().length === 0
                }
              >
                Save
              </Button>
            </div>
            <span
              className={cn(
                "text-xs font-medium",
                isDirty ? "text-amber-400" : "text-muted-foreground"
              )}
            >
              {isDirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>

          {displayedParsedSummary ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>v{displayedParsedSummary.version}</span>
              <span>{displayedParsedSummary.channel_count} channels</span>
              <span>{displayedParsedSummary.scenario_names.length} scenarios</span>
              <Badge variant={displayedParsedSummary.has_position_mapping ? "success" : "secondary"}>
                {displayedParsedSummary.has_position_mapping ? "Position mapping" : "No position mapping"}
              </Badge>
              <Badge variant={displayedParsedSummary.has_ingestion ? "success" : "secondary"}>
                {displayedParsedSummary.has_ingestion ? "Ingestion" : "No ingestion"}
              </Badge>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoadingSelectedPath ? (
          <div
            className="text-muted-foreground bg-muted/20 flex h-full min-h-0 items-center justify-center text-sm"
            data-testid="vehicle-config-loading-shell"
          >
            Loading {selectedPath}...
          </div>
        ) : (
          <VehicleConfigEditor
            value={content}
            onChange={setContent}
            path={draftPath}
            className="h-full rounded-t-none rounded-b-xl border-0"
          />
        )}
      </div>
    </section>
  );
}

export default function VehicleConfigsPage() {
  const [selectedPath, setSelectedPath] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    if (typeof window === "undefined") return 300;
    const storedWidth = Number(window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY));
    return Number.isFinite(storedWidth) ? storedWidth : 300;
  });
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<string[] | null>(() => {
    if (typeof window === "undefined") return null;
    const storedExpanded = window.localStorage.getItem(EXPLORER_EXPANDED_STORAGE_KEY);
    if (!storedExpanded) return null;

    try {
      const parsed = JSON.parse(storedExpanded);
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : null;
    } catch {
      window.localStorage.removeItem(EXPLORER_EXPANDED_STORAGE_KEY);
      return null;
    }
  });
  const [isWideLayout, setIsWideLayout] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const listQuery = useVehicleConfigsQuery();
  const effectiveSelectedPath = selectedPath || listQuery.data?.[0]?.path || "";
  const configQuery = useVehicleConfigQuery(effectiveSelectedPath, effectiveSelectedPath.length > 0);
  const isLoadingSelectedPath =
    effectiveSelectedPath.length > 0 &&
    (!configQuery.data || configQuery.data.path !== effectiveSelectedPath);
  const workspaceKey = configQuery.data?.path ?? `new:${effectiveSelectedPath}`;
  const tree = buildVehicleConfigTree(listQuery.data ?? []);
  const resolvedExpandedFolderPaths =
    expandedFolderPaths ?? defaultExpandedFolders(listQuery.data ?? [], effectiveSelectedPath);
  const expandedFolders = new Set([
    ...resolvedExpandedFolderPaths,
    ...ancestorFolderPaths(effectiveSelectedPath),
  ]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const applyLayout = () => setIsWideLayout(mediaQuery.matches);
    applyLayout();
    mediaQuery.addEventListener("change", applyLayout);
    return () => mediaQuery.removeEventListener("change", applyLayout);
  }, []);

  useEffect(() => {
    if (expandedFolderPaths === null) return;
    window.localStorage.setItem(EXPLORER_EXPANDED_STORAGE_KEY, JSON.stringify(expandedFolderPaths));
  }, [expandedFolderPaths]);

  useEffect(() => {
    if (!isWideLayout) return;

    function syncWidth() {
      const containerWidth = workspaceRef.current?.getBoundingClientRect().width;
      if (!containerWidth) return;
      setExplorerWidth((currentWidth) => clampExplorerWidth(currentWidth, containerWidth));
    }

    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, [isWideLayout]);

  function handleSelectPath(path: string) {
    if (path === effectiveSelectedPath) return;
    if (hasUnsavedChanges && !window.confirm("Discard unsaved vehicle configuration changes?")) {
      return;
    }
    setExpandedFolderPaths((current) => {
      const merged = new Set(current ?? resolvedExpandedFolderPaths);
      for (const folder of ancestorFolderPaths(path)) merged.add(folder);
      return Array.from(merged);
    });
    setSelectedPath(path);
  }

  function handleToggleFolder(path: string) {
    setExpandedFolderPaths((current) => {
      const next = new Set(current ?? resolvedExpandedFolderPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return Array.from(next);
    });
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isWideLayout) return;

    const containerRect = workspaceRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const containerLeft = containerRect.left;
    const containerWidth = containerRect.width;

    event.preventDefault();

    function updateWidth(clientX: number) {
      const nextWidth = clampExplorerWidth(clientX - containerLeft, containerWidth);
      setExplorerWidth(nextWidth);
      window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(nextWidth));
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      updateWidth(moveEvent.clientX);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  return (
    <div className="bg-background flex h-[calc(100dvh-57px)] min-h-0 flex-col">
      <div className="px-4 pt-3 pb-2 sm:px-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link href="/sources">
              <ArrowLeft className="size-4" />
              Back to Sources
            </Link>
          </Button>
        </div>
      </div>

      <div ref={workspaceRef} className="min-h-0 flex-1 px-2 pb-2 sm:px-4 sm:pb-4">
        <div className={cn("flex h-full min-h-0 gap-2", isWideLayout ? "flex-row" : "flex-col")}>
          <aside
            className={cn(
              "bg-muted/15 min-h-0 rounded-xl border border-border/60",
              isWideLayout ? "shrink-0" : "h-64"
            )}
            style={isWideLayout ? { width: explorerWidth } : undefined}
          >
            <div className="h-full overflow-auto p-2" data-testid="vehicle-config-explorer">
              {listQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : tree.children.length > 0 ? (
                <div className="space-y-1">
                  {tree.children.map((node) => (
                    <ExplorerNode
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={effectiveSelectedPath}
                      expandedFolders={expandedFolders}
                      onToggleFolder={handleToggleFolder}
                      onSelectPath={handleSelectPath}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground px-2 py-4 text-sm">No configuration files found.</div>
              )}
            </div>
          </aside>

          {isWideLayout ? (
            <button
              type="button"
              onPointerDown={handleResizeStart}
              className="text-muted-foreground/70 hover:text-muted-foreground flex w-2 shrink-0 cursor-col-resize items-center justify-center transition-colors"
              role="separator"
              aria-label="Resize explorer"
              aria-orientation="vertical"
              data-testid="vehicle-config-resize-handle"
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null}

          <div className="min-h-0 min-w-0 flex-1">
            <VehicleConfigEditorWorkspace
              key={workspaceKey}
              document={configQuery.data}
              initialPath={effectiveSelectedPath}
              selectedPath={effectiveSelectedPath}
              isLoadingSelectedPath={isLoadingSelectedPath}
              onDirtyChange={setHasUnsavedChanges}
              onSelectPath={setSelectedPath}
              onRefreshList={listQuery.refetch}
              onRefreshDocument={configQuery.refetch}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
