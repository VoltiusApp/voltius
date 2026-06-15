import { readClipboard } from "../../utils/clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { broadcastSnippetInject } from "@/services/snippets";
import {
  parseVariables,
  needsUserInput,
  buildDynamicValues,
  buildDefaultValues,
  resolveTemplate,
  type ParsedVariable,
  type DynamicContext,
} from "@/services/snippetParser";
import { buildDynamicContext } from "@/services/snippetRunCore";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { SnippetForm } from "@/components/snippets/SnippetForm";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import type { Snippet, Folder, SnippetFormData, FolderFormData } from "@/types";
import type { Connection } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isContextuallyRelevant(snippet: Snippet, conn: Connection | undefined): boolean {
  if (snippet.only_for_connection_tags?.length && conn) {
    if (!conn.tags.some((t) => snippet.only_for_connection_tags.includes(t))) return false;
  }
  if (snippet.only_for_distros?.length && conn) {
    if (!snippet.only_for_distros.includes(conn.distro ?? "")) return false;
  }
  return true;
}

// ─── Folder create/rename modal ───────────────────────────────────────────────

function FolderModal({
  folder,
  onSave,
  onClose,
}: {
  folder: Folder | null;
  onSave: (data: FolderFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), object_type: "snippet" }); }
    finally { setSaving(false); }
  }

  const inputStyle = { background: "var(--t-bg-input)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-80 rounded-xl shadow-2xl border flex flex-col overflow-hidden"
        style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--t-border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {folder ? "Rename folder" : "New folder"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}>
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>
        <div className="p-4">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Folder name" className="w-full px-2.5 py-1.5 text-xs rounded-sm border outline-hidden"
            style={inputStyle} />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: "var(--t-border)" }}>
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
            style={{ background: "var(--t-accent)", color: "var(--t-tab-active-text)" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Snippet row ──────────────────────────────────────────────────────────────

interface SnippetRowProps {
  snippet: Snippet;
  canInject: boolean;
  dimmed: boolean;
  folders: Folder[];
  onInsert: () => void;
  onExecute: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onMoveToFolder: (folderId: string | null) => void;
}

function SnippetRow({
  snippet, canInject, dimmed, folders,
  onInsert, onExecute, onEdit, onDuplicate, onDelete, onToggleFavorite, onMoveToFolder,
}: SnippetRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [movingToFolder, setMovingToFolder] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMovingToFolder(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <div
      className="group px-3 py-2 border-b transition-colors"
      style={{ borderColor: "var(--t-border)", opacity: dimmed ? 0.45 : 1 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      title={dimmed ? "Not relevant for current connection" : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--t-text-primary)" }}>
              {snippet.name}
            </p>
            {snippet.favorite && (
              <Icon icon="lucide:star" width={10} style={{ color: "var(--t-accent)", flexShrink: 0 }} />
            )}
          </div>
          <p className="text-[11px] font-mono truncate mt-0.5 leading-tight" style={{ color: "var(--t-text-muted)" }}>
            {snippet.content}
          </p>
          {snippet.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {snippet.tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-sm"
                  style={{ background: "var(--t-bg-input)", color: "var(--t-text-muted)" }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <button onClick={onToggleFavorite} title={snippet.favorite ? "Remove from favorites" : "Add to favorites"}
            className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors"
            style={{ color: snippet.favorite ? "var(--t-accent)" : "var(--t-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = snippet.favorite ? "var(--t-accent)" : "var(--t-text-muted)")}>
            <Icon icon={snippet.favorite ? "lucide:star" : "lucide:star"} width={12} />
          </button>

          <button onClick={onInsert} disabled={!canInject} title={canInject ? "Insert" : "No active session"}
            className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors disabled:opacity-30"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { if (canInject) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"}>
            <Icon icon="lucide:arrow-down-to-line" width={13} />
          </button>
          <button onClick={onExecute} disabled={!canInject} title={canInject ? "Insert & execute" : "No active session"}
            className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors disabled:opacity-30"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { if (canInject) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"}>
            <Icon icon="lucide:play" width={13} />
          </button>

          <div className="relative" ref={menuRef}>
            <button onClick={() => { setMenuOpen((o) => !o); setMovingToFolder(false); }}
              className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors"
              style={{ color: "var(--t-text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}>
              <Icon icon="lucide:ellipsis" width={13} />
            </button>
            {menuOpen && !movingToFolder && (
              <div className="absolute right-0 top-7 z-50 rounded-lg shadow-lg border py-1 min-w-[150px]"
                style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}>
                <button onClick={() => { onEdit(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Icon icon="lucide:pencil" width={12} /> Edit
                </button>
                <button onClick={() => { onDuplicate(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Icon icon="lucide:copy" width={12} /> Duplicate
                </button>
                <button onClick={() => setMovingToFolder(true)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span className="flex items-center gap-2"><Icon icon="lucide:folder" width={12} /> Move to folder</span>
                  <Icon icon="lucide:chevron-right" width={10} />
                </button>
                <div className="my-1 border-t" style={{ borderColor: "var(--t-border)" }} />
                <button onClick={() => { onDelete(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                  style={{ color: "var(--t-status-error)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Icon icon="lucide:trash-2" width={12} /> Delete
                </button>
              </div>
            )}
            {menuOpen && movingToFolder && (
              <div className="absolute right-0 top-7 z-50 rounded-lg shadow-lg border py-1 min-w-[150px]"
                style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}>
                <button onClick={() => setMovingToFolder(false)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs"
                  style={{ color: "var(--t-text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Icon icon="lucide:arrow-left" width={11} /> Back
                </button>
                <div className="my-1 border-t" style={{ borderColor: "var(--t-border)" }} />
                <button onClick={() => { onMoveToFolder(null); setMenuOpen(false); setMovingToFolder(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Icon icon="lucide:inbox" width={12} /> Unfiled
                </button>
                {folders.map((f) => (
                  <button key={f.id}
                    onClick={() => { onMoveToFolder(f.id); setMenuOpen(false); setMovingToFolder(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                    style={{ color: "var(--t-text-primary)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <Icon icon="lucide:folder" width={12} style={{ color: f.color ?? "var(--t-text-muted)" }} />
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, count, collapsible, collapsed, onToggle }: {
  label: string; count: number; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void;
}) {
  return (
    <button
      className="w-full flex items-center justify-between px-3 py-1.5 text-left"
      onClick={collapsible ? onToggle : undefined}
      style={{ cursor: collapsible ? "pointer" : "default" }}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-muted)" }}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>{count}</span>
        {collapsible && (
          <Icon icon={collapsed ? "lucide:chevron-right" : "lucide:chevron-down"}
            width={11} style={{ color: "var(--t-text-muted)" }} />
        )}
      </div>
    </button>
  );
}

// ─── Pending inject state ─────────────────────────────────────────────────────

interface PendingInject {
  snippet: Snippet;
  userVars: ParsedVariable[];
  partialTemplate: string;
  initialValues: Record<string, string>;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SnippetsPanel() {
  const { snippets, loading, recentSnippetIds, loadSnippets, createSnippet, updateSnippet, deleteSnippet, trackUsed } =
    useSnippetStore();
  const { folders, loadFolders, saveFolder, updateFolder, deleteFolder } = useSnippetFolderStore();
  const { sessions, activeSessionId } = useSessionStore();
  const { connections } = useConnectionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConn = connections.find((c) => c.id === activeSession?.connectionId);

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingSnippetId, setEditingSnippetId] = useState<string | null | "new">(null);
  // Tracks the id of a snippet created during a "new" session, so subsequent
  // autosaves update rather than re-create.
  const [createdSnippetId, setCreatedSnippetId] = useState<string | null>(null);
  const liveEditingSnippet = editingSnippetId && editingSnippetId !== "new"
    ? (snippets.find((s) => s.id === editingSnippetId) ?? null)
    : null;
  const snippetIsDirtyRef = useRef(false);
  const formSessionKeyRef = useRef<string>("__new__");
  const snippetFormVersion = useSyncedFormKey(
    liveEditingSnippet?.updated_at,
    editingSnippetId !== null && editingSnippetId !== "new",
    () => snippetIsDirtyRef.current,
  );
  const [editingFolder, setEditingFolder] = useState<Folder | null | "new">(null);
  const [pendingInject, setPendingInject] = useState<PendingInject | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const openSnippetEditor = useCallback((item: Snippet | "new") => {
    snippetIsDirtyRef.current = false;
    formSessionKeyRef.current = item === "new" ? `new-${Date.now()}` : item.id;
    setCreatedSnippetId(null);
    setEditingSnippetId(item === "new" ? "new" : item.id);
  }, []);

  const closeSnippetEditor = useCallback(() => {
    setEditingSnippetId(null);
    setCreatedSnippetId(null);
  }, []);

  const handleSnippetFormSubmit = useCallback(async (data: SnippetFormData) => {
    if (editingSnippetId === "new") {
      if (createdSnippetId) {
        await updateSnippet(createdSnippetId, data);
      } else {
        const created = await createSnippet(data);
        setCreatedSnippetId(created.id);
      }
    } else if (editingSnippetId) {
      await updateSnippet(editingSnippetId, data);
    }
  }, [editingSnippetId, createdSnippetId, createSnippet, updateSnippet]);

  useEffect(() => {
    loadSnippets();
    loadFolders();
  }, []);

  useEffect(() => {
    const focus = () => { searchRef.current?.focus(); searchRef.current?.select(); };
    window.addEventListener("voltius:focus-panel-search", focus);
    return () => window.removeEventListener("voltius:focus-panel-search", focus);
  }, []);

  const canInject = !!activeSession && activeSession.type !== "multiplayer";

  const allFiltered = snippets.filter(
    (s) =>
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.content.toLowerCase().includes(query.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
  );

  async function buildContext(): Promise<DynamicContext> {
    let clipboard = "";
    try { clipboard = await readClipboard(); } catch { /* permission denied or unavailable */ }
    return buildDynamicContext(activeSession, connections, clipboard);
  }

  async function inject(text: string, execute: boolean) {
    if (!activeSession || activeSession.type === "multiplayer") return;
    try { await broadcastSnippetInject(activeSession.id, activeSession.type, text, execute); }
    catch (e) { console.error("snippet_inject failed:", e); }
  }

  async function handleTrigger(snippet: Snippet, execute: boolean) {
    if (!activeSession || activeSession.type === "multiplayer") return;
    trackUsed(snippet.id);

    const allVars = parseVariables(snippet.content);
    const ctx = await buildContext();
    const dynamicValues = buildDynamicValues(allVars, ctx);
    const userVars = allVars.filter((v) => !v.dynamic);
    const defaultValues = buildDefaultValues(userVars);
    const partialTemplate = resolveTemplate(snippet.content, dynamicValues);

    if (!userVars.some(needsUserInput)) {
      inject(resolveTemplate(partialTemplate, defaultValues), execute);
      return;
    }
    setPendingInject({ snippet, userVars, partialTemplate, initialValues: defaultValues });
  }

  async function handleMoveToFolder(snippet: Snippet, folderId: string | null) {
    await updateSnippet(snippet.id, {
      name: snippet.name,
      content: snippet.content,
      description: snippet.description,
      tags: snippet.tags,
      folder_id: folderId ?? undefined,
      favorite: snippet.favorite,
      only_for_connection_tags: snippet.only_for_connection_tags,
      only_for_distros: snippet.only_for_distros,
      vault_id: snippet.vault_id,
    });
  }

  async function handleToggleFavorite(snippet: Snippet) {
    await updateSnippet(snippet.id, {
      name: snippet.name,
      content: snippet.content,
      description: snippet.description,
      tags: snippet.tags,
      folder_id: snippet.folder_id,
      favorite: !snippet.favorite,
      only_for_connection_tags: snippet.only_for_connection_tags,
      only_for_distros: snippet.only_for_distros,
      vault_id: snippet.vault_id,
    });
  }

  async function handleDuplicate(snippet: Snippet) {
    await createSnippet({
      name: `${snippet.name} (copy)`,
      content: snippet.content,
      description: snippet.description,
      tags: [...snippet.tags],
      folder_id: snippet.folder_id,
      favorite: false,
      only_for_connection_tags: [...snippet.only_for_connection_tags],
      only_for_distros: [...snippet.only_for_distros],
      vault_id: snippet.vault_id,
    });
  }

  function toggleFolderCollapse(id: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSection(name: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function renderSnippetRow(snippet: Snippet) {
    const dimmed = !isContextuallyRelevant(snippet, activeConn);
    return (
      <SnippetRow
        key={snippet.id}
        snippet={snippet}
        canInject={canInject}
        dimmed={dimmed}
        folders={folders}
        onInsert={() => handleTrigger(snippet, false)}
        onExecute={() => handleTrigger(snippet, true)}
        onEdit={() => openSnippetEditor(snippet)}
        onDuplicate={() => handleDuplicate(snippet)}
        onDelete={() => deleteSnippet(snippet.id)}
        onToggleFavorite={() => handleToggleFavorite(snippet)}
        onMoveToFolder={(fId) => handleMoveToFolder(snippet, fId)}
      />
    );
  }

  // Build sections
  const favorites = allFiltered.filter((s) => s.favorite);
  const recentSnippets = recentSnippetIds
    .map((id) => allFiltered.find((s) => s.id === id))
    .filter(Boolean) as Snippet[];
  const folderIds = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, Snippet[]>();
  const unfiled: Snippet[] = [];
  for (const s of allFiltered) {
    // Orphaned snippets (folder_id of a deleted folder) fall back to unfiled.
    if (s.folder_id && folderIds.has(s.folder_id)) {
      if (!byFolder.has(s.folder_id)) byFolder.set(s.folder_id, []);
      byFolder.get(s.folder_id)!.push(s);
    } else {
      unfiled.push(s);
    }
  }

  const hasQuery = query.length > 0;

  // Slide-in editor takes over the whole panel — same pattern as SnippetPickerPanel
  if (editingSnippetId !== null) {
    return (
      <SnippetForm
        key={`${formSessionKeyRef.current}-${snippetFormVersion}`}
        initial={liveEditingSnippet ?? undefined}
        onSubmit={handleSnippetFormSubmit}
        onClose={closeSnippetEditor}
        onDuplicate={liveEditingSnippet ? () => { void handleDuplicate(liveEditingSnippet); closeSnippetEditor(); } : undefined}
        onDelete={liveEditingSnippet ? () => { void deleteSnippet(liveEditingSnippet.id); closeSnippetEditor(); } : undefined}
        isDirtyRef={snippetIsDirtyRef}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + Add */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--t-border)" }}>
        <div className="flex-1 relative">
          <Icon icon="lucide:search" width={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--t-text-muted)" }} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search snippets…"
            className="w-full pl-6 pr-2 py-1 text-xs rounded-sm border outline-hidden"
            style={{ background: "var(--t-bg-input)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
        </div>
        <button onClick={() => openSnippetEditor("new")} title="New snippet"
          className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0"
          style={{ color: "var(--t-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}>
          <Icon icon="lucide:plus" width={15} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>Loading…</span>
          </div>
        )}

        {!loading && allFiltered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-8 opacity-40">
            <Icon icon="lucide:braces" width={24} style={{ color: "var(--t-text-muted)" }} />
            <p className="text-xs text-center" style={{ color: "var(--t-text-muted)" }}>
              {query ? "No snippets match" : "No snippets yet.\nClick + to create one."}
            </p>
          </div>
        )}

        {/* Favorites section */}
        {!hasQuery && favorites.length > 0 && (
          <>
            <SectionHeader label="Favorites" count={favorites.length}
              collapsible collapsed={collapsedSections.has("favorites")}
              onToggle={() => toggleSection("favorites")} />
            {!collapsedSections.has("favorites") && favorites.map(renderSnippetRow)}
          </>
        )}

        {/* Recent section */}
        {!hasQuery && recentSnippets.length > 0 && (
          <>
            <SectionHeader label="Recent" count={recentSnippets.length}
              collapsible collapsed={collapsedSections.has("recent")}
              onToggle={() => toggleSection("recent")} />
            {!collapsedSections.has("recent") && recentSnippets.map(renderSnippetRow)}
          </>
        )}

        {/* Folder sections */}
        {folders.map((folder) => {
          const folderSnippets = hasQuery
            ? allFiltered.filter((s) => s.folder_id === folder.id)
            : byFolder.get(folder.id) ?? [];
          if (folderSnippets.length === 0 && !hasQuery) return null;
          const isCollapsed = collapsedFolders.has(folder.id);
          return (
            <div key={folder.id}>
              <div className="flex items-center justify-between"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <button className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left"
                  onClick={() => toggleFolderCollapse(folder.id)}>
                  <Icon icon={isCollapsed ? "lucide:chevron-right" : "lucide:chevron-down"}
                    width={11} style={{ color: "var(--t-text-muted)" }} />
                  <Icon icon="lucide:folder" width={13}
                    style={{ color: folder.color ?? "var(--t-text-muted)" }} />
                  <span className="text-[11px] font-medium" style={{ color: "var(--t-text-primary)" }}>
                    {folder.name}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
                    {folderSnippets.length}
                  </span>
                </button>
                <div className="flex items-center pr-2 gap-0.5">
                  <button onClick={() => setEditingFolder(folder)}
                    className="w-6 h-6 flex items-center justify-center rounded-sm"
                    style={{ color: "var(--t-text-muted)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}>
                    <Icon icon="lucide:pencil" width={11} />
                  </button>
                  <button onClick={() => deleteFolder(folder.id)}
                    className="w-6 h-6 flex items-center justify-center rounded-sm"
                    style={{ color: "var(--t-text-muted)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}>
                    <Icon icon="lucide:trash-2" width={11} />
                  </button>
                </div>
              </div>
              {!isCollapsed && folderSnippets.map(renderSnippetRow)}
            </div>
          );
        })}

        {/* Unfiled snippets */}
        {unfiled.length > 0 && (
          <>
            {(folders.length > 0 || recentSnippets.length > 0 || favorites.length > 0) && !hasQuery && (
              <SectionHeader label="Unfiled" count={unfiled.length}
                collapsible collapsed={collapsedSections.has("unfiled")}
                onToggle={() => toggleSection("unfiled")} />
            )}
            {(!collapsedSections.has("unfiled") || hasQuery) && unfiled.map(renderSnippetRow)}
          </>
        )}
      </div>

      {/* Modals */}
      {editingFolder !== null && (
        <FolderModal
          folder={editingFolder === "new" ? null : editingFolder}
          onSave={async (data) => {
            if (editingFolder === "new") await saveFolder(data);
            else await updateFolder(editingFolder.id, data);
            setEditingFolder(null);
          }}
          onClose={() => setEditingFolder(null)}
        />
      )}

      {pendingInject !== null && (
        <SnippetVariableModal
          snippetName={pendingInject.snippet.name}
          partialTemplate={pendingInject.partialTemplate}
          userVars={pendingInject.userVars}
          initialValues={pendingInject.initialValues}
          onInject={(resolvedText, execute) => {
            inject(resolvedText, execute);
            setPendingInject(null);
          }}
          onClose={() => setPendingInject(null)}
        />
      )}
    </div>
  );
}
