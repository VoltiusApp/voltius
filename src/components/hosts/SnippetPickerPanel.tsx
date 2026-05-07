import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useUIStore } from "@/stores/uiStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { snippetInject } from "@/services/snippets";
import {
  parseVariables,
  needsUserInput,
  buildDynamicValues,
  buildDefaultValues,
  resolveTemplate,
  type ParsedVariable,
} from "@/services/snippetParser";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { PanelShell, PanelHeader, PanelHeaderIconButton } from "@/components/shared/Panel";
import { SnippetForm } from "@/components/snippets/SnippetForm";
import type { Snippet, SnippetFormData } from "@/types";

interface PendingInject {
  snippet: Snippet;
  userVars: ParsedVariable[];
  initialValues: Record<string, string>;
  execute: boolean;
}

interface Props {
  connectionIds: string[];
  onClose: () => void;
}

export function SnippetPickerPanel({ connectionIds, onClose }: Props) {
  const snippets = useAllSnippets();
  const { loadSnippets, recentSnippetIds, trackUsed, createSnippet, updateSnippet } = useSnippetStore();
  const { sessions, connectMany } = useSessionStore();
  const openSessions = useLayoutStore((s) => s.openSessions);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const connections = useAllConnections();

  useEffect(() => { void loadSnippets(); }, [loadSnippets]);

  const [search, setSearch] = useState("");
  const [pendingInject, setPendingInject] = useState<PendingInject | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Inline create (reuses full SnippetForm) ───────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  // Track the created snippet's id so autosave updates rather than re-creates
  const [createdSnippetId, setCreatedSnippetId] = useState<string | null>(null);

  const handleFormSubmit = useCallback(async (data: SnippetFormData) => {
    if (createdSnippetId) {
      await updateSnippet(createdSnippetId, data);
    } else {
      const s = await createSnippet(data);
      setCreatedSnippetId(s.id);
    }
  }, [createdSnippetId, createSnippet, updateSnippet]);

  const handleFormClose = useCallback(() => {
    setIsCreating(false);
    setCreatedSnippetId(null);
  }, []);

  // ── Inject logic ──────────────────────────────────────────────────────────
  const searchQuery = search.trim().toLowerCase();

  const recentSnippets = useMemo(
    () => recentSnippetIds.flatMap((id) => {
      const s = snippets.find((sn) => sn.id === id);
      return s ? [s] : [];
    }),
    [snippets, recentSnippetIds],
  );

  const filtered = useMemo(
    () => snippets.filter((s) => {
      if (!searchQuery) return true;
      return (
        s.name.toLowerCase().includes(searchQuery) ||
        s.content.toLowerCase().includes(searchQuery) ||
        s.tags.some((t) => t.toLowerCase().includes(searchQuery))
      );
    }),
    [snippets, searchQuery],
  );

  const doInjectText = useCallback(async (snippet: Snippet, partiallyResolvedText: string, execute: boolean) => {
    setError(null);
    try {
      const vars = parseVariables(snippet.content);

      const toConnect: string[] = [];
      const toInject: Array<{ sessionId: string; connId: string }> = [];

      for (const connId of connectionIds) {
        const conn = connections.find((c) => c.id === connId);
        if (!conn || conn.connection_type === "serial") continue;
        const live = sessions.find((s) => s.connectionId === connId && s.status === "connected" && s.type === "ssh");
        if (live) {
          toInject.push({ sessionId: live.id, connId });
        } else {
          toConnect.push(connId);
        }
      }

      for (const { sessionId, connId } of toInject) {
        const conn = connections.find((c) => c.id === connId);
        const ctx = {
          connectionHost: conn?.host ?? "",
          connectionUsername: conn?.username ?? "",
          connectionName: conn?.name ?? conn?.host ?? "",
        };
        const dynamicVals = buildDynamicValues(vars, ctx);
        const finalText = resolveTemplate(partiallyResolvedText, dynamicVals);
        await snippetInject(sessionId, "ssh", finalText, execute);
      }

      const newSessionIds = toConnect.length > 0 ? await connectMany(toConnect) : [];
      const allSessionIds = [...toInject.map((x) => x.sessionId), ...newSessionIds];
      if (allSessionIds.length > 0) openSessions(allSessionIds);
      setActiveNav("terminal" as any);
      trackUsed(snippet.id);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  }, [connectionIds, connections, sessions, connectMany, openSessions, setActiveNav, trackUsed, onClose]);

  const handleTrigger = useCallback((snippet: Snippet, execute: boolean) => {
    const vars = parseVariables(snippet.content);
    const userVars = vars.filter((v) => !v.dynamic);
    const initialValues = buildDefaultValues(userVars);

    if (userVars.some(needsUserInput)) {
      setPendingInject({ snippet, userVars, initialValues, execute });
    } else {
      void doInjectText(snippet, resolveTemplate(snippet.content, initialValues), execute);
    }
  }, [doInjectText]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {isCreating ? (
        <SnippetForm
          onSubmit={handleFormSubmit}
          onClose={handleFormClose}
        />
      ) : (
        <PanelShell>
          <PanelHeader
            icon="lucide:braces"
            title="Execute Snippet"
            onClose={onClose}
            actions={
              <PanelHeaderIconButton
                icon="lucide:external-link"
                title="Go to Snippets"
                onClick={() => { setActiveNav("snippets" as any); onClose(); }}
              />
            }
          />

          {/* Toolbar: search + New Snippet */}
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 bg-[var(--t-bg-toolbar)]">
            <div className="relative flex-1">
              <Icon
                icon="lucide:search"
                width={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--t-text-dim)]"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter snippets..."
                className="w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
              />
            </div>
            <button
              title="New snippet"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1 shrink-0 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
              style={{ background: "var(--t-bg-input)", color: "var(--t-text-primary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            >
              <Icon icon="lucide:plus" width={13} />
              New
            </button>
          </div>

          {/* Snippet list */}
          <div className="flex-1 overflow-y-auto py-1 bg-[var(--t-bg-terminal)]">
            {snippets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
                <Icon icon="lucide:braces" width={28} className="text-[var(--t-text-dim)]" />
                <p className="text-xs text-[var(--t-text-dim)]">No snippets yet</p>
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-[var(--t-accent)] border border-[var(--t-border-hover)]"
                  style={{ background: "var(--t-bg-elevated)" }}
                >
                  <Icon icon="lucide:plus" width={12} />
                  Create snippet
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center text-[var(--t-text-dim)]">No snippets match</p>
            ) : (
              <>
                {recentSnippets.length > 0 && !searchQuery && (
                  <div className="mb-0.5">
                    <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                      Recent
                    </p>
                    {recentSnippets.map((s) => (
                      <SnippetRow key={s.id} snippet={s} onTrigger={handleTrigger} />
                    ))}
                  </div>
                )}
                {!searchQuery && recentSnippets.length > 0 && (
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                    All Snippets
                  </p>
                )}
                {filtered.map((s) => (
                  <SnippetRow key={s.id} snippet={s} onTrigger={handleTrigger} />
                ))}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-t-[var(--t-bg-terminal)] bg-[var(--t-bg-status-bar)]">
            {error && (
              <div className="px-4 py-2 text-xs" style={{ color: "var(--t-error, #f87171)" }}>
                {error}
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Icon icon="lucide:server" width={12} className="text-[var(--t-text-dim)] shrink-0" />
              <p className="text-xs text-[var(--t-text-dim)]">
                {connectionIds.length === 1 ? "1 host selected" : `${connectionIds.length} hosts selected`}
              </p>
            </div>
          </div>
        </PanelShell>
      )}

      {pendingInject && (
        <SnippetVariableModal
          snippetName={pendingInject.snippet.name}
          partialTemplate={pendingInject.snippet.content}
          userVars={pendingInject.userVars}
          initialValues={pendingInject.initialValues}
          onInject={(resolvedText, execute) => {
            const snap = pendingInject;
            setPendingInject(null);
            void doInjectText(snap.snippet, resolvedText, execute);
          }}
          onClose={() => setPendingInject(null)}
        />
      )}
    </>
  );
}

// ─── Snippet row ──────────────────────────────────────────────────────────────

function SnippetRow({ snippet, onTrigger }: { snippet: Snippet; onTrigger: (s: Snippet, execute: boolean) => void }) {
  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--t-bg-elevated)]">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
      >
        <Icon icon="lucide:braces" width={13} className="text-[var(--t-text-dim)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate text-[var(--t-text-bright)]">{snippet.name}</p>
        <p className="text-[11px] truncate font-mono text-[var(--t-text-dim)]">
          {snippet.description || snippet.content}
        </p>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          title="Insert"
          onClick={() => onTrigger(snippet, false)}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors text-[var(--t-text-dim)]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--t-bg-card-hover)";
            e.currentTarget.style.color = "var(--t-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--t-text-dim)";
          }}
        >
          <Icon icon="lucide:skip-forward" width={12} />
        </button>
        <button
          title="Execute"
          onClick={() => onTrigger(snippet, true)}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors"
          style={{ color: "var(--t-accent)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon icon="lucide:play" width={12} />
        </button>
      </div>
    </div>
  );
}
