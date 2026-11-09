import { writeClipboard } from "../../utils/clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { favoriteKey, useFavoriteCommandStore } from "@/stores/favoriteCommandStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { isTeamConnection } from "@/services/teamConnectionIds";
import { broadcastSnippetInject } from "@/services/snippetInject";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { formatRelative } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";

interface HistoryItem {
  id: string;
  command: string;
  connectionId: string;
  sessionName: string;
  timestamp: number;
  favorite: boolean;
}

interface HostFilter {
  id: string;
  /** Shown when the host is no longer among the saved connections. */
  label: string;
}

const SNIPPET_NAME_MAX = 40;

function snippetNameFor(command: string): string {
  return command.length > SNIPPET_NAME_MAX ? `${command.slice(0, SNIPPET_NAME_MAX - 1)}…` : command;
}

function RowButton({
  icon,
  title,
  onClick,
  disabled,
  color,
  filled,
  hoverClass = "enabled:hover:text-(--t-text-primary)",
  className = "",
}: {
  icon: string;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** A fixed colour for a state (copied, favorite); it also turns the hover colour off. */
  color?: string;
  filled?: boolean;
  hoverClass?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-6 h-6 flex items-center justify-center rounded-sm transition-colors disabled:opacity-30 ${color ? "" : hoverClass} ${className}`}
      style={{ color: color ?? "var(--t-text-muted)" }}
    >
      <Icon icon={icon} width={12} className={filled ? "[&_path]:fill-current" : undefined} />
    </button>
  );
}

function HistoryRow({
  item,
  hostName,
  canInject,
  onToggleFavorite,
  onInsert,
  onExecute,
  onFilterHost,
  menuItems,
}: {
  item: HistoryItem;
  hostName: string;
  canInject: boolean;
  onToggleFavorite: () => void;
  onInsert: () => void;
  onExecute: () => void;
  onFilterHost: () => void;
  menuItems: ContextMenuItem[];
}) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(1200);
  const menu = useContextMenu();
  const noSession = t("terminal.shared.noActiveSession");
  const starTitle = item.favorite
    ? t("terminal.historyPanel.removeFavorite")
    : isTeamConnection(item.connectionId)
      ? t("terminal.historyPanel.addFavoriteTeam")
      : t("terminal.historyPanel.addFavorite");

  function handleCopy() {
    writeClipboard(item.command).catch(() => {});
    flash();
  }

  return (
    <div
      className="group px-3 py-2 border-b transition-colors hover:bg-(--t-bg-elevated)"
      style={{ borderColor: "var(--t-border)" }}
      onContextMenu={menu.open}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p
            className="text-[11px] font-mono leading-tight break-all"
            style={{ color: "var(--t-text-primary)" }}
            title={item.command}
          >
            {item.command}
          </p>
          <p className="flex text-[10px] mt-1 min-w-0" style={{ color: "var(--t-text-muted)" }}>
            <button
              onClick={onFilterHost}
              title={t("terminal.historyPanel.showOnlyHost", { host: hostName })}
              className="truncate min-w-0 hover:underline hover:text-(--t-accent)"
            >
              {hostName}
            </button>
            <span className="shrink-0 whitespace-pre">
              {" · "}{formatRelative(item.timestamp, { seconds: true, maxDays: 7 })}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <RowButton
            icon="lucide:star"
            title={starTitle}
            onClick={onToggleFavorite}
            color={item.favorite ? "var(--t-status-warning)" : undefined}
            filled={item.favorite}
          />
          <RowButton
            icon={copied ? "lucide:check" : "lucide:copy"}
            title={copied ? t("terminal.shared.copied") : t("common.action.copy")}
            onClick={handleCopy}
            color={copied ? "var(--t-accent)" : undefined}
          />
          <RowButton
            icon="lucide:arrow-down-to-line"
            title={canInject ? t("terminal.shared.insert") : noSession}
            onClick={onInsert}
            disabled={!canInject}
          />
          <RowButton
            icon="lucide:play"
            title={canInject ? t("terminal.shared.insertAndExecute") : noSession}
            onClick={onExecute}
            disabled={!canInject}
            hoverClass="enabled:hover:text-(--t-accent)"
          />
          <RowButton
            icon="lucide:ellipsis"
            title={t("common.action.moreOptions")}
            onClick={(e) => menu.openAt(e.currentTarget.getBoundingClientRect())}
            className={menu.pos ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}
          />
        </div>
      </div>
      {menu.pos && <ContextMenu items={menuItems} pos={menu.pos} onClose={menu.close} />}
    </div>
  );
}

function GroupHeader({ label, count, open, onToggle }: { label: string; count: number; open?: boolean; onToggle?: () => void }) {
  const content = (
    <>
      {onToggle && <Icon icon={open ? "lucide:chevron-down" : "lucide:chevron-right"} width={11} />}
      <span>{label}</span>
      <span className="font-normal tracking-normal opacity-80">{count}</span>
    </>
  );
  const className = "w-full flex items-center gap-1 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-left";
  const style = { color: "var(--t-text-muted)" };
  return onToggle ? (
    <button onClick={onToggle} aria-expanded={open} className={className} style={style}>{content}</button>
  ) : (
    <div className={className} style={style}>{content}</div>
  );
}

export function HistoryPanel() {
  const { t } = useTranslation();
  const entries = useCommandHistoryStore((s) => s.entries);
  const clear = useCommandHistoryStore((s) => s.clear);
  const remove = useCommandHistoryStore((s) => s.remove);
  const favorites = useFavoriteCommandStore((s) => s.favorites);
  const [recording] = useToggle("command-history");
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const connections = useAllConnections();

  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [hostFilter, setHostFilter] = useState<HostFilter | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const canInject = !!activeSession && activeSession.type !== "multiplayer";
  const filteringCurrent = !!activeSession && hostFilter?.id === activeSession.connectionId;

  useEffect(() => {
    const focus = () => { searchRef.current?.focus(); searchRef.current?.select(); };
    window.addEventListener("voltius:focus-panel-search", focus);
    return () => window.removeEventListener("voltius:focus-panel-search", focus);
  }, []);

  useEffect(() => {
    useFavoriteCommandStore.getState().load().catch(() => {});
  }, []);

  const hostNames = useMemo(() => new Map(connections.map((c) => [c.id, c.name])), [connections]);
  const hostName = (connectionId: string, fallback: string) => hostNames.get(connectionId) ?? fallback;

  const unstarred = useMemo(() => {
    const starred = new Set(favorites.map((f) => favoriteKey(f.connection_id, f.command)));
    return entries.filter((e) => !starred.has(favoriteKey(e.connectionId, e.command)));
  }, [entries, favorites]);

  const { favoriteItems, recentItems } = useMemo(() => {
    const match = query ? searchMatcher(query) : null;
    const keep = (item: HistoryItem) =>
      (!hostFilter || item.connectionId === hostFilter.id) &&
      (!match || match(item.command, item.sessionName, hostNames.get(item.connectionId) ?? ""));
    const favoriteItems = favorites
      .map((f): HistoryItem => ({
        id: f.id,
        command: f.command,
        connectionId: f.connection_id,
        sessionName: f.session_name,
        timestamp: Date.parse(f.created_at),
        favorite: true,
      }))
      .filter(keep);
    const recentItems = unstarred.map((e): HistoryItem => ({ ...e, favorite: false })).filter(keep).reverse();
    return { favoriteItems, recentItems };
  }, [unstarred, favorites, query, hostFilter, hostNames]);

  async function inject(text: string, execute: boolean) {
    if (!activeSession || activeSession.type === "multiplayer") return;
    try {
      await broadcastSnippetInject([activeSession], text, execute);
    } catch (e) {
      console.error("history inject failed:", e);
    }
  }

  function toggleFavorite(item: HistoryItem) {
    const store = useFavoriteCommandStore.getState();
    const done = item.favorite ? store.remove(item.id) : store.add(item.command, item.connectionId, item.sessionName);
    done.catch((e) => console.error("favorite command update failed:", e));
  }

  function removeItem(item: HistoryItem) {
    if (!item.favorite) {
      remove(item.id);
      return;
    }
    toggleFavorite(item);
    for (const e of entries) {
      if (e.connectionId === item.connectionId && e.command === item.command) remove(e.id);
    }
  }

  function saveAsSnippet(command: string) {
    useSnippetStore.getState().setSnippetDraft({
      name: snippetNameFor(command),
      steps: [{ kind: "script", content: command }],
    });
    useUIStore.getState().setRightPanelSection("snippets");
  }

  const filterBy = (item: HistoryItem) =>
    setHostFilter({ id: item.connectionId, label: hostName(item.connectionId, item.sessionName) });

  function renderRow(item: HistoryItem) {
    const name = hostName(item.connectionId, item.sessionName);
    const menuItems: ContextMenuItem[] = [
      { label: t("terminal.historyPanel.saveAsSnippet"), icon: "lucide:braces", onClick: () => saveAsSnippet(item.command) },
      { label: t("terminal.historyPanel.showOnlyHost", { host: name }), icon: "lucide:filter", onClick: () => filterBy(item) },
      {
        label: item.favorite ? t("common.action.remove") : t("terminal.historyPanel.removeFromHistory"),
        icon: "lucide:x",
        danger: true,
        divider: true,
        onClick: () => removeItem(item),
      },
    ];
    return (
      <HistoryRow
        key={item.id}
        item={item}
        hostName={name}
        canInject={canInject}
        onToggleFavorite={() => toggleFavorite(item)}
        onInsert={() => inject(item.command, false)}
        onExecute={() => inject(item.command, true)}
        onFilterHost={() => filterBy(item)}
        menuItems={menuItems}
      />
    );
  }

  const emptyMessage = !recording
    ? t("terminal.historyPanel.historyOff")
    : query
    ? t("terminal.historyPanel.noCommandsMatch")
    : hostFilter
    ? t("terminal.historyPanel.noHistoryForConnection")
    : t("terminal.historyPanel.noHistoryYet");
  const nothingShown = favoriteItems.length === 0 && recentItems.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--t-border)" }}>
        <div
          className="flex-1 min-w-0 flex items-center gap-1 pl-2 pr-1 rounded-sm border"
          style={{ background: "var(--t-bg-input)", borderColor: "var(--t-border)" }}
        >
          <Icon icon="lucide:search" width={12} className="shrink-0 pointer-events-none" style={{ color: "var(--t-text-muted)" }} />
          {hostFilter && (
            <span
              className="flex items-center gap-0.5 min-w-0 max-w-[45%] pl-1.5 pr-0.5 rounded-full text-[10px] shrink-0"
              style={{ background: "color-mix(in srgb, var(--t-accent) 16%, transparent)", color: "var(--t-accent)" }}
            >
              <span className="truncate">{hostName(hostFilter.id, hostFilter.label)}</span>
              <button
                onClick={() => setHostFilter(null)}
                title={t("terminal.historyPanel.clearHostFilter")}
                aria-label={t("terminal.historyPanel.clearHostFilter")}
                className="w-3.5 h-3.5 shrink-0 flex items-center justify-center rounded-full hover:bg-(--t-bg-elevated)"
              >
                <Icon icon="lucide:x" width={9} />
              </button>
            </span>
          )}
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Backspace" && !query && hostFilter) setHostFilter(null); }}
            placeholder={t("terminal.historyPanel.searchPlaceholder")}
            className="flex-1 min-w-0 py-1 text-xs bg-transparent outline-hidden"
            style={{ color: "var(--t-text-primary)" }}
          />
        </div>
        <button
          onClick={() => setHostFilter(filteringCurrent || !activeSession ? null : { id: activeSession.connectionId, label: activeSession.connectionName })}
          title={filteringCurrent ? t("terminal.historyPanel.showAllConnections") : t("terminal.historyPanel.showCurrentHost")}
          aria-pressed={filteringCurrent}
          disabled={!activeSession}
          className={`w-7 h-7 flex items-center justify-center rounded-lg shrink-0 disabled:opacity-30 ${filteringCurrent ? "" : "enabled:hover:text-(--t-text-primary)"}`}
          style={{ color: filteringCurrent ? "var(--t-accent)" : "var(--t-text-muted)" }}
        >
          <Icon icon="lucide:filter" width={13} />
        </button>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={unstarred.length === 0}
          title={t("terminal.historyPanel.clearAllTitle")}
          className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0 disabled:opacity-30 enabled:hover:text-(--t-status-error)"
          style={{ color: "var(--t-text-muted)" }}
        >
          <Icon icon="lucide:trash-2" width={13} />
        </button>
      </div>

      {confirmClear && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-b shrink-0 text-[11px]"
          style={{ borderColor: "var(--t-border)", background: "color-mix(in srgb, var(--t-status-error) 8%, transparent)", color: "var(--t-text-primary)" }}
          onKeyDown={(e) => { if (e.key === "Escape") setConfirmClear(false); }}
        >
          <p className="flex-1 min-w-0 leading-snug">
            {t("terminal.historyPanel.clearConfirm", { count: unstarred.length })}
            {favorites.length > 0 && <> {t("terminal.historyPanel.favoritesStay", { count: favorites.length })}</>}
          </p>
          <button
            onClick={() => setConfirmClear(false)}
            className="h-6 px-2 text-[10px] font-semibold rounded-md border shrink-0"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          >
            {t("common.action.cancel")}
          </button>
          <button
            onClick={() => { clear(); setConfirmClear(false); }}
            autoFocus
            className="h-6 px-2 text-[10px] font-semibold rounded-md shrink-0"
            style={{ background: "var(--t-status-error)", color: "white" }}
          >
            {t("terminal.historyPanel.clear")}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {nothingShown && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-8 opacity-40">
            <Icon icon="lucide:clock" width={24} style={{ color: "var(--t-text-muted)" }} />
            <p className="text-xs text-center" style={{ color: "var(--t-text-muted)" }}>
              {emptyMessage}
            </p>
          </div>
        )}

        {favorites.length > 0 && !nothingShown && (
          <>
            <GroupHeader
              label={t("terminal.historyPanel.favorites")}
              count={favoriteItems.length}
              open={favoritesOpen}
              onToggle={() => setFavoritesOpen((v) => !v)}
            />
            {favoritesOpen && favoriteItems.map(renderRow)}
            <GroupHeader label={t("terminal.historyPanel.recent")} count={recentItems.length} />
          </>
        )}

        {recentItems.map(renderRow)}
      </div>
    </div>
  );
}
