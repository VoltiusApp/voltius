import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { snippetScriptText, snippetSearchText } from "@/services/snippetSteps";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { PanelShell, PanelHeader, PanelHeaderIconButton } from "@/components/shared/Panel";
import { useFilterShortcut } from "@/components/shared/ToolbarViewControls";
import { SnippetForm } from "@/components/snippets/SnippetForm";
import type { Snippet, SnippetFormData } from "@/types";
import { shouldOpenSnippetTargetsInSplitTab } from "./hostSelection";

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
  const { t } = useTranslation();
  const snippets = useAllSnippets();
  const { loadSnippets, recentSnippetIds, trackUsed, createSnippet, updateSnippet } = useSnippetStore();
  const { sessions, connectMany, setActive } = useSessionStore();
  const openSessions = useLayoutStore((s) => s.openSessions);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const connections = useAllConnections();

  useEffect(() => { void loadSnippets(); }, [loadSnippets]);

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(searchRef);
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
        snippetSearchText(s).toLowerCase().includes(searchQuery) ||
        s.tags.some((t) => t.toLowerCase().includes(searchQuery))
      );
    }),
    [snippets, searchQuery],
  );

  const doInjectText = useCallback(async (snippet: Snippet, partiallyResolvedText: string, execute: boolean) => {
    setError(null);
    try {
      const vars = parseVariables(snippetScriptText(snippet));

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
      if (shouldOpenSnippetTargetsInSplitTab(allSessionIds.length)) {
        openSessions(allSessionIds);
      } else if (allSessionIds.length === 1) {
        setActive(allSessionIds[0]);
        useLayoutStore.getState().setSplitTabActive(false);
      }
      setActiveNav("terminal");
      trackUsed(snippet.id);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  }, [connectionIds, connections, sessions, connectMany, openSessions, setActive, setActiveNav, trackUsed, onClose]);

  const handleTrigger = useCallback((snippet: Snippet, execute: boolean) => {
    const text = snippetScriptText(snippet);
    const vars = parseVariables(text);
    const userVars = vars.filter((v) => !v.dynamic);
    const initialValues = buildDefaultValues(userVars);

    if (userVars.some(needsUserInput)) {
      setPendingInject({ snippet, userVars, initialValues, execute });
    } else {
      void doInjectText(snippet, resolveTemplate(text, initialValues), execute);
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
            title={t("hosts.snippetPicker.title")}
            onClose={onClose}
            actions={
              <PanelHeaderIconButton
                icon="lucide:external-link"
                title={t("hosts.snippetPicker.goToSnippets")}
                onClick={() => { setActiveNav("snippets"); onClose(); }}
              />
            }
          />

          {/* Toolbar: search + New Snippet */}
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 bg-(--t-bg-toolbar)">
            <div className="relative flex-1">
              <Icon
                icon="lucide:search"
                width={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--t-text-dim)"
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("hosts.snippetPicker.filterPlaceholder")}
                className="form-input w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
              />
            </div>
            <button
              title={t("hosts.snippetPicker.newSnippetTitle")}
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1 shrink-0 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
              style={{ background: "var(--t-bg-input)", color: "var(--t-text-primary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            >
              <Icon icon="lucide:plus" width={13} />
              {t("hosts.snippetPicker.new")}
            </button>
          </div>

          {/* Snippet list */}
          <div className="flex-1 overflow-y-auto py-1 bg-(--t-bg-terminal)">
            {snippets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
                <Icon icon="lucide:braces" width={28} className="text-(--t-text-dim)" />
                <p className="text-xs text-(--t-text-dim)">{t("hosts.snippetPicker.noSnippetsYet")}</p>
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-(--t-accent) border border-(--t-border-hover)"
                  style={{ background: "var(--t-bg-elevated)" }}
                >
                  <Icon icon="lucide:plus" width={12} />
                  {t("hosts.snippetPicker.createSnippet")}
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center text-(--t-text-dim)">{t("hosts.snippetPicker.noSnippetsMatch")}</p>
            ) : (
              <>
                {recentSnippets.length > 0 && !searchQuery && (
                  <div className="mb-0.5">
                    <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">
                      {t("hosts.snippetPicker.recent")}
                    </p>
                    {recentSnippets.map((s) => (
                      <SnippetRow key={s.id} snippet={s} onTrigger={handleTrigger} />
                    ))}
                  </div>
                )}
                {!searchQuery && recentSnippets.length > 0 && (
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim)">
                    {t("hosts.snippetPicker.allSnippets")}
                  </p>
                )}
                {filtered.map((s) => (
                  <SnippetRow key={s.id} snippet={s} onTrigger={handleTrigger} />
                ))}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-t-(--t-bg-terminal) bg-(--t-bg-status-bar)">
            {error && (
              <div className="px-4 py-2 text-xs" style={{ color: "var(--t-error, #f87171)" }}>
                {error}
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Icon icon="lucide:server" width={12} className="text-(--t-text-dim) shrink-0" />
              <p className="text-xs text-(--t-text-dim)">
                {t("hosts.snippetPicker.hostsSelected", { count: connectionIds.length })}
              </p>
            </div>
          </div>
        </PanelShell>
      )}

      {pendingInject && (
        <SnippetVariableModal
          snippetName={pendingInject.snippet.name}
          partialTemplate={snippetScriptText(pendingInject.snippet)}
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
  const { t } = useTranslation();
  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-(--t-bg-elevated)">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
      >
        <Icon icon="lucide:braces" width={13} className="text-(--t-text-dim)" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate text-(--t-text-bright)">{snippet.name}</p>
        <p className="text-[11px] truncate font-mono text-(--t-text-dim)">
          {snippet.description || snippetSearchText(snippet)}
        </p>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          title={t("hosts.snippetPicker.insert")}
          onClick={() => onTrigger(snippet, false)}
          className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors text-(--t-text-dim)"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--t-bg-card-hover)";
            e.currentTarget.style.color = "var(--t-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--t-text-dim)";
          }}
        >
          <Icon icon="lucide:arrow-down-to-line" width={12} />
        </button>
        <button
          title={t("hosts.snippetPicker.execute")}
          onClick={() => onTrigger(snippet, true)}
          className="w-6 h-6 flex items-center justify-center rounded-sm transition-colors"
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
