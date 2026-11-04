import { Fragment, useEffect, useRef, useState, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { englishLabel, resolveLabel } from "@/plugins/resolveLabel";
import { VaultBadge } from "@/components/shared/VaultBadge";
import { useUIStore } from "@/stores/uiStore";
import type { SettingsSection } from "@/stores/uiStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useSnippetStore } from "@/stores/snippetStore";
import {
  parseVariables, needsUserInput, buildDynamicValues, buildDefaultValues,
  resolveTemplate, type DynamicContext,
} from "@/services/snippetParser";
import { broadcastSnippetInject } from "@/services/snippetInject";
import { runSnippetSequence, reportSequenceResult } from "@/services/snippetSequence";
import { getActiveRunnableSession } from "@/services/snippetRun";
import { snippetMatcher, snippetScriptText } from "@/services/snippetSteps";
import { SnippetPreview } from "@/components/snippets/HighlightedScript";
import { searchMatcher } from "@/utils/search";
import { matchesSearch } from "@/utils/connectionFilter";
import type { Connection, TerminalSession, SshKey, Identity, Snippet } from "@/types";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { sessionStatusTone } from "@/utils/statusTone";
import { sessionLabel, sessionMatchesQuery } from "@/utils/sessionLabel";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { mobileSettingsNav } from "@/components/settings/settingsMobileCore";
import { useIsAndroid } from "@/utils/platform";
import { useUiLanguage } from "@/i18n";
import { useShortcutStore, formatShortcut } from "@/stores/shortcutStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { ActiveSession } from "@/stores/teamSessionStore";
import { joinSessionByCode, joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";
import { useToggleSettings } from "@/hooks/useToggleSettings";
import { parseQuickConnect, type QuickConnectIntent } from "@/services/quickConnect";
import { launchHost, launchQuickConnect, launchLocalShell } from "@/services/launch";
import { sessionDisplayName } from "@/services/teamSharing";
import { isJoinInput, joinInputStrength } from "@/services/resolveJoinInput";
import { appToast } from "@/services/appToast";
import { commandGuard } from "@/commands/defineCommand";
import { recentlyUsed } from "@/utils/recentHosts";
import {
  selectLocalShellItems,
  localShellNeedsPath,
  shellLabel,
  shellIcon,
  type ShellOption,
} from "@/components/layout/newSessionItems";
import { useLocalShells } from "@/hooks/useLocalShells";
import { useThemeStore } from "@/stores/themeStore";
import OmniThemeSwitch from "@/components/omni/OmniThemeSwitch";
import OmniThemeAutomation from "@/components/omni/OmniThemeAutomation";
import { OmniRow, OmniTile, type RowNotice } from "@/components/omni/OmniRow";
import { SCOPES, detectScope, type Category } from "@/components/omni/omniScope";
import { suggestPlugins } from "@/components/omni/omniPlugins";
import { useInstallablePlugins } from "@/hooks/useInstallablePlugins";
import { catalogEntryIcon } from "@/plugins/catalogIcon";
import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";

interface OmniSearchProps {
  onClose: () => void;
}

type OmniView = "root" | "theme-switch" | "theme-automation";

type OmniItem =
  | { kind: "host"; connection: Connection; recent?: boolean }
  | { kind: "session"; session: TerminalSession; connection: Connection | undefined }
  | { kind: "key"; key: SshKey }
  | { kind: "identity"; identity: Identity }
  | { kind: "action"; id: string; label: string; icon: string; description?: string; keybinding?: string }
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "team-session"; session: ActiveSession; alreadyIn: boolean }
  | { kind: "toggle"; id: string; label: string; icon: string; description?: string; keywords?: string[]; value: boolean; locked?: boolean; onToggle: (v: boolean) => void }
  | { kind: "quick-connect"; intent: Exclude<QuickConnectIntent, null> }
  | { kind: "join-code"; code: string }
  | { kind: "join-code-prompt" }
  | { kind: "local-shell"; shell: ShellOption | null }
  | { kind: "plugin"; plugin: MarketplacePlugin };

const ADDRESS_RE = /^(\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

function itemKey(item: OmniItem): string {
  switch (item.kind) {
    case "host": return `h-${item.connection.id}${item.recent ? "-r" : ""}`;
    case "session": return `s-${item.session.id}`;
    case "key": return `k-${item.key.id}`;
    case "identity": return `i-${item.identity.id}`;
    case "action": return `a-${item.id}`;
    case "snippet": return `sn-${item.snippet.id}`;
    case "team-session": return `ts-${item.session.id}`;
    case "toggle": return `t-${item.id}`;
    case "quick-connect": return "quick-connect";
    case "join-code": return "join-code";
    case "join-code-prompt": return "join-code-prompt";
    case "local-shell": return item.shell ? `ls-${item.shell.path}` : "ls-default";
    case "plugin": return `p-${item.plugin.id}`;
  }
}

function sectionOf(item: OmniItem): string {
  switch (item.kind) {
    case "join-code": return "joinByInviteCode";
    case "quick-connect": return "quickConnect";
    case "session": return "activeConnections";
    case "team-session":
    case "join-code-prompt": return "teamSessions";
    case "host": return item.recent ? "recent" : "hosts";
    case "local-shell": return "local";
    case "key":
    case "identity": return "keychain";
    case "snippet": return "snippets";
    case "toggle": return "quickSettings";
    case "action": return item.id.startsWith("open-settings:") ? "settings" : "actions";
    case "plugin": return "availablePlugins";
  }
}

const rowId = (idx: number) => `omni-opt-${idx}`;

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <kbd className="font-mono text-(--t-text-secondary)">{keys}</kbd>
      {label}
    </span>
  );
}

export default function OmniSearch({ onClose }: OmniSearchProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Category>("all");
  const [query, setQuery] = useState(() => useUIStore.getState().omniSeed);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<(RowNotice & { key: string; armed: boolean }) | null>(null);
  const [omniView, setOmniView] = useState<OmniView>("root");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const connections = useAllConnections();
  const shells = useLocalShells();
  const { sessions, setActive } = useSessionStore();
  const snippets = useSnippetStore((s) => s.snippets);
  const { trackUsed, setGlobalPendingInject } = useSnippetStore();
  const identities = useIdentityStore((s) => s.identities);
  const keys = useKeyStore((s) => s.keys);
  const { activeSessions: teamSessions, fetchActiveSessions } = useTeamSessionStore();
  const mpConnections = useTeamSessionStore((s) => s.connections);
  const myMpSessionIds = useMemo(
    () => new Set(Object.values(mpConnections).map((c) => c.multiplayerSessionId)),
    [mpConnections],
  );
  const omniCommandsMap = usePluginStore((s) => s.omniCommands);
  const pluginCommands = useMemo(() => [...omniCommandsMap.values()], [omniCommandsMap]);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const settingsPagesMap = usePluginStore((s) => s.settingsPages);
  const { merged: pluginCatalog, taken: takenPluginIds, appVersion } = useInstallablePlugins();
  const catalogLoading = useMarketplaceStore((s) => s.catalogLoading);
  const locale = useUiLanguage();
  const isAndroid = useIsAndroid();
  const nav = useMemo(() => (isAndroid ? mobileSettingsNav(getSettingsNav()) : getSettingsNav()), [locale, isAndroid]);

  const settingsItems = useMemo<OmniItem[]>(() => {
    const base = nav.map((n): OmniItem => ({
      kind: "action",
      id: `open-settings:${n.id}`,
      label: n.label,
      icon: n.icon,
    }));
    const pluginPages = [...settingsPagesMap.values()].map((p): OmniItem => ({
      kind: "action",
      id: `open-settings:plugin:${p.id}`,
      label: resolveLabel(p.label),
      icon: p.icon,
      description: t("omni.pluginSettingsDescription"),
    }));
    return [...base, ...pluginPages];
  }, [nav, settingsPagesMap, t]);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const setHomePendingAction = useUIStore((s) => s.setHomePendingAction);
  const setKeychainPendingAction = useUIStore((s) => s.setKeychainPendingAction);

  const toggleSettings = useToggleSettings();
  const toggleItems = useMemo<OmniItem[]>(
    () => toggleSettings.map(({ id, ...d }) => ({ kind: "toggle" as const, id: `toggle:${id}`, ...d })),
    [toggleSettings],
  );

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => { fetchActiveSessions().catch(() => {}); }, [fetchActiveSessions]);

  const category = scope;
  const q = useMemo(() => query.toLowerCase().trim(), [query]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === "connected" || s.status === "connecting"),
    [sessions],
  );

  const activeConnectionIds = useMemo(
    () => new Set(activeSessions.map((s) => s.connectionId)),
    [activeSessions],
  );

  const recentConnections = useMemo(
    () => recentlyUsed(connections.filter((c) => !activeConnectionIds.has(c.id))),
    [activeConnectionIds, connections],
  );

  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );

  const items: OmniItem[] = useMemo(() => {
    const match = searchMatcher(q);
    const snippetMatches = snippetMatcher(q);
    const settingsMatches = (a: OmniItem) =>
      a.kind === "action" &&
      match(a.label, ...(nav.find((n) => `open-settings:${n.id}` === a.id)?.keywords ?? []));
    const toggleMatches = (a: OmniItem) => a.kind === "toggle" && match(a.label, ...(a.keywords ?? []));

    if (category === "settings") {
      return [...settingsItems.filter((a) => !q || settingsMatches(a)), ...toggleItems.filter(toggleMatches)];
    }
    if (category === "snippets") {
      return snippets.filter(snippetMatches).map((s): OmniItem => ({ kind: "snippet", snippet: s }));
    }
    const pluginItems = (browsing: boolean) =>
      suggestPlugins(pluginCatalog, takenPluginIds, appVersion, q, browsing)
        .map((plugin): OmniItem => ({ kind: "plugin", plugin }));
    if (category === "marketplace") return pluginItems(true);
    if (category === "join") {
      if (isJoinInput(q)) return [{ kind: "join-code", code: query.trim() }];
      const sessionItems = teamSessions
        .filter((s) => match(sessionDisplayName(s)))
        .map((s): OmniItem => ({ kind: "team-session", session: s, alreadyIn: myMpSessionIds.has(s.id) }));
      return [...sessionItems, { kind: "join-code-prompt" }];
    }

    const result: OmniItem[] = [];
    const joinStrength = joinInputStrength(query);
    if (joinStrength === "strong") result.push({ kind: "join-code", code: query.trim() });

    // Local shells are surfaced by the dedicated Local section below.
    const quickIntent = parseQuickConnect(query);
    const hostMatches = connections.filter((c) =>
      q ? matchesSearch(c, q) || match(...(c.tags ?? [])) : !activeConnectionIds.has(c.id) && !c.last_used_at,
    );
    const addressIntent = !quickIntent && hostMatches.length === 0 && ADDRESS_RE.test(q) ? parseQuickConnect(`ssh ${q}`) : null;
    const connectIntent = quickIntent && quickIntent.kind !== "local" ? quickIntent : addressIntent;
    if (connectIntent) result.push({ kind: "quick-connect", intent: connectIntent });

    result.push(
      ...activeSessions
        .filter((s) => sessionMatchesQuery(s, q))
        .map((s): OmniItem => ({ kind: "session", session: s, connection: connectionById.get(s.connectionId) })),
    );

    result.push(
      ...teamSessions
        .filter((s) => match(sessionDisplayName(s)))
        .map((s): OmniItem => ({ kind: "team-session", session: s, alreadyIn: myMpSessionIds.has(s.id) })),
    );

    if (!q) result.push(...recentConnections.map((c): OmniItem => ({ kind: "host", connection: c, recent: true })));
    result.push(...hostMatches.map((c): OmniItem => ({ kind: "host", connection: c })));

    result.push(
      ...selectLocalShellItems(shells, q).map((it): OmniItem => ({ kind: "local-shell", shell: it.shell })),
    );

    result.push(
      ...keys
        .filter((k) => match(k.name, k.key_type))
        .map((k): OmniItem => ({ kind: "key", key: k })),
    );

    result.push(
      ...identities
        .filter((i) => match(i.name, i.username))
        .map((i): OmniItem => ({ kind: "identity", identity: i })),
    );

    if (q) result.push(...snippets.filter(snippetMatches).map((s): OmniItem => ({ kind: "snippet", snippet: s })));

    const actionsSection = t("omni.sections.actions");
    const importExportSection = t("omni.sections.importExport");
    result.push(
      ...pluginCommands
        .map((cmd) => ({ cmd, label: resolveLabel(cmd.label), section: cmd.section === undefined ? undefined : resolveLabel(cmd.section) }))
        .filter(({ cmd, label, section }) =>
          (q || section !== importExportSection) && match(label, englishLabel(cmd.label), ...(cmd.keywords ?? [])))
        .map(({ cmd, label, section }): OmniItem => {
          const sc = cmd.shortcutId ? shortcuts.find((s) => s.id === cmd.shortcutId) : undefined;
          return {
            kind: "action",
            id: `plugin:${cmd.id}`,
            label,
            icon: cmd.icon,
            description: section === actionsSection ? undefined : section,
            keybinding: cmd.keybinding ?? (sc && formatShortcut(sc)),
          };
        }),
    );

    const themeActions: OmniItem[] = [
      { kind: "action", id: "theme:toggle", label: t("omni.theme.toggle"), icon: "lucide:sun-moon", description: t("omni.theme.toggleDesc") },
      { kind: "action", id: "theme:switch", label: t("omni.theme.switch"), icon: "lucide:palette", description: t("omni.theme.switchDesc") },
      { kind: "action", id: "theme:automation", label: t("omni.theme.automation"), icon: "lucide:clock", description: t("omni.theme.automationDesc") },
    ];
    result.push(...themeActions.filter((a) => a.kind === "action" && match(a.label, a.description)));

    if (q) result.push(...toggleItems.filter(toggleMatches));
    if (q) result.push(...settingsItems.filter(settingsMatches));

    if (joinStrength === "weak") result.push({ kind: "join-code", code: query.trim() });

    result.push(...pluginItems(false));

    return result;
  }, [category, q, query, activeSessions, recentConnections, connections, activeConnectionIds, keys, identities, connectionById, pluginCommands, settingsItems, snippets, shortcuts, teamSessions, myMpSessionIds, toggleItems, shells, nav, pluginCatalog, takenPluginIds, appVersion, t]);

  const shellNeedsPath = useMemo(() => {
    const shown = items
      .filter((i): i is Extract<OmniItem, { kind: "local-shell" }> => i.kind === "local-shell" && !!i.shell)
      .map((i) => i.shell!);
    return localShellNeedsPath(shown);
  }, [items]);

  useEffect(() => { setSelected(0); }, [query, scope]);
  useEffect(() => { setNotice(null); }, [query, scope, selected]);

  const editHost = useCallback((id: string) => {
    setHomePendingAction({ action: "edit", id });
    setActiveNav("hosts");
    onClose();
  }, [setHomePendingAction, setActiveNav, onClose]);

  const failJoin = useCallback((e: unknown) => {
    appToast("error", t("omni.joinFailed", { reason: e instanceof Error ? e.message : String(e) }));
  }, [t]);

  const selectItem = useCallback(
    (item: OmniItem) => {
      if (item.kind === "host") {
        launchHost(item.connection.id);
        onClose();
      } else if (item.kind === "session") {
        setActive(item.session.id);
        setActiveNav("terminal");
        onClose();
      } else if (item.kind === "key") {
        setKeychainPendingAction({ action: "edit-key", id: item.key.id });
        setActiveNav("keychain");
        onClose();
      } else if (item.kind === "identity") {
        setKeychainPendingAction({ action: "edit-identity", id: item.identity.id });
        setActiveNav("keychain");
        onClose();
      } else if (item.kind === "action") {
        if (item.id === "theme:toggle") { useThemeStore.getState().toggleLightDark(); onClose(); return; }
        if (item.id === "theme:switch") { setOmniView("theme-switch"); setQuery(""); return; }
        if (item.id === "theme:automation") { setOmniView("theme-automation"); setQuery(""); return; }
        if (item.id.startsWith("plugin:")) {
          const cmdId = item.id.slice("plugin:".length);
          const cmd = pluginCommands.find((c) => c.id === cmdId);
          const guard = cmd && commandGuard(cmd)?.();
          const key = itemKey(item);
          if (guard && !guard.proceed) { setNotice({ key, text: guard.message, tone: "info", armed: false }); return; }
          if (guard && !(notice?.key === key && notice.armed)) {
            setNotice({ key, text: guard.message, tone: "danger", armed: true });
            return;
          }
          cmd?.execute();
        } else if (item.id.startsWith("open-settings:")) {
          const rest = item.id.slice("open-settings:".length);
          if (rest.startsWith("plugin:")) {
            openSettings("plugins", rest.slice("plugin:".length));
          } else {
            openSettings(rest as SettingsSection);
          }
        }
        onClose();
      } else if (item.kind === "snippet") {
        const activeSession = getActiveRunnableSession();
        if (!activeSession) {
          setNotice({ key: itemKey(item), text: t("omni.snippetNeedsSession"), tone: "info", armed: false });
          return;
        }

        if (item.snippet.steps.some((s) => s.kind !== "script")) {
          trackUsed(item.snippet.id);
          onClose();
          runSnippetSequence(
            item.snippet,
            [{ kind: "session", sessionId: activeSession.id, sessionType: activeSession.type }],
            useSnippetStore.getState().enqueuePendingSequence,
          ).then((r) => {
            if (r !== "prompting") reportSequenceResult(r);
          }).catch((e) => console.error(e));
          return;
        }

        const conn = connections.find((c) => c.id === activeSession.connectionId);
        const ctx: DynamicContext = activeSession.type === "local"
          ? { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell" }
          : { connectionHost: conn?.host ?? "", connectionUsername: conn?.username ?? "", connectionName: activeSession.connectionName };

        const snippetText = snippetScriptText(item.snippet);
        const allVars = parseVariables(snippetText);
        const dynamicValues = buildDynamicValues(allVars, ctx);
        const userVars = allVars.filter((v) => !v.dynamic);
        const defaultValues = buildDefaultValues(userVars);
        const partialTemplate = resolveTemplate(snippetText, dynamicValues);

        trackUsed(item.snippet.id);
        onClose();

        if (userVars.some(needsUserInput)) {
          setGlobalPendingInject({
            snippet: item.snippet,
            userVars,
            partialTemplate,
            execute: true,
            sessionIds: [activeSession.id],
            initialValues: defaultValues,
          });
        } else {
          const resolved = resolveTemplate(partialTemplate, defaultValues);
          broadcastSnippetInject([activeSession], resolved, true).catch(console.error);
        }
      } else if (item.kind === "toggle") {
        if (!item.locked) item.onToggle(!item.value);
      } else if (item.kind === "team-session") {
        const { session, alreadyIn } = item;
        if (alreadyIn) {
          const localId = Object.entries(useTeamSessionStore.getState().connections).find(
            ([, v]) => v.multiplayerSessionId === session.id,
          )?.[0];
          if (localId) {
            setActive(localId);
            setActiveNav("terminal");
          }
        } else {
          (async () => {
            await joinTeamSessionAndOpenTab({
              sessionId: session.id,
              connectionName: sessionDisplayName(session),
            });
            setSidebarOpen(false);
          })().catch(failJoin);
        }
        onClose();
      } else if (item.kind === "join-code-prompt") {
        inputRef.current?.focus();
      } else if (item.kind === "join-code") {
        (async () => {
          await joinSessionByCode(item.code);
          setSidebarOpen(false);
        })().catch(failJoin);
        onClose();
      } else if (item.kind === "local-shell") {
        launchLocalShell(item.shell?.path);
        onClose();
      } else if (item.kind === "quick-connect") {
        launchQuickConnect(item.intent);
        onClose();
      } else if (item.kind === "plugin") {
        openSettings("plugins");
        useUIStore.getState().setPluginBrowseQuery(item.plugin.name);
        onClose();
      }
    },
    [setActive, setActiveNav, onClose, setSidebarOpen, openSettings, setKeychainPendingAction, pluginCommands,
     connections, trackUsed, setGlobalPendingInject, notice, failJoin, t],
  );

  const cycleScope = useCallback((step: number) => {
    const i = SCOPES.findIndex((s) => s.category === scope);
    setScope(SCOPES[(i + step + SCOPES.length) % SCOPES.length].category);
  }, [scope]);

  const onInputChange = (raw: string) => {
    const detected = scope === "all" ? detectScope(raw) : null;
    if (detected) {
      setScope(detected.category);
      setQuery(detected.rest);
    } else {
      setQuery(raw);
    }
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (omniView !== "root") return;
    if (e.key === "Tab") { e.preventDefault(); cycleScope(e.shiftKey ? -1 : 1); return; }
    if (e.key === "Backspace" && query === "" && scope !== "all") { e.preventDefault(); setScope("all"); }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (omniView !== "root") { setOmniView("root"); setQuery(""); return; }
        onClose();
        return;
      }
      if (omniView !== "root") return;
      const n = items.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); setSelected((s) => (s + 1) % n); }
      if (e.key === "ArrowUp" && n) { e.preventDefault(); setSelected((s) => (s - 1 + n) % n); }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selected];
        if (!item) return;
        if (e.shiftKey && item.kind === "host") editHost(item.connection.id);
        else selectItem(item);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [items, selected, selectItem, editHost, onClose, omniView]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const groups = useMemo(() => {
    const out: { section: string; start: number; items: OmniItem[] }[] = [];
    items.forEach((item, i) => {
      const section = sectionOf(item);
      const last = out[out.length - 1];
      if (last?.section === section) last.items.push(item);
      else out.push({ section, start: i, items: [item] });
    });
    return out;
  }, [items]);

  const selectedItem = items[selected];
  const emptyText =
    category === "snippets" ? t("omni.emptyState.noSnippets") :
    category === "marketplace" ? (catalogLoading ? t("omni.emptyState.loadingPlugins") : q ? t("omni.emptyState.noResultsFor", { query: q }) : t("omni.emptyState.noPlugins")) :
    category === "join" ? (q ? t("omni.emptyState.noSessionsMatch", { query: q }) : t("omni.emptyState.noActiveTeamSessions")) :
    t("omni.emptyState.noResultsFor", { query: q });
  const liveText = notice?.text ?? (items.length ? t("omni.resultCount", { count: items.length }) : emptyText);

  function renderItem(item: OmniItem, idx: number) {
    const key = itemKey(item);
    const row = {
      key,
      id: rowId(idx),
      idx,
      selected: selected === idx,
      notice: notice?.key === key ? notice : null,
      onPick: () => selectItem(item),
      onHover: setSelected,
    };

    switch (item.kind) {
      case "session": {
        const conn = item.connection;
        return (
          <OmniRow
            {...row}
            leading={conn ? (
              <div className="relative shrink-0">
                <ConnectionAvatar connection={conn} size={28} />
                <StatusDot tone={sessionStatusTone(item.session.status)} size="sm" halo="var(--t-bg-card)" corner />
              </div>
            ) : <StatusDot tone={sessionStatusTone(item.session.status)} />}
            label={sessionLabel(item.session)}
            trailing={<>
              <VaultBadge vaultId={conn?.vault_id} />
              <span className="text-xs shrink-0 text-(--t-text-dim)">{item.session.status}</span>
            </>}
          />
        );
      }
      case "host": {
        const conn = item.connection;
        const address = conn.username ? `${conn.username}@${conn.host}` : conn.host;
        return (
          <OmniRow
            {...row}
            leading={<ConnectionAvatar connection={conn} size={28} />}
            label={conn.name || address}
            trailing={<>
              <VaultBadge vaultId={conn.vault_id} />
              {conn.name && <span className="text-xs shrink-0 max-w-[12rem] truncate text-(--t-text-dim)">{address}</span>}
              {row.selected && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); editHost(conn.id); }}
                  className="p-1 -my-1 rounded-md shrink-0 transition-colors text-(--t-text-dim) hover:bg-(--t-bg-elevated) hover:text-(--t-text-primary)"
                  title={t("omni.editHost")}
                >
                  <Icon icon="lucide:pencil" width={13} />
                </button>
              )}
            </>}
          />
        );
      }
      case "key":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon="lucide:key-round" />}
            label={item.key.name}
            trailing={<>
              <VaultBadge vaultId={item.key.vault_id} />
              {item.key.key_type && (
                <span className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded-sm bg-(--t-bg-elevated) text-(--t-accent)">
                  {item.key.key_type}
                </span>
              )}
            </>}
          />
        );
      case "identity":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon="lucide:id-card" />}
            label={item.identity.name ?? item.identity.username}
            trailing={<>
              <VaultBadge vaultId={item.identity.vault_id} />
              <span className="text-xs shrink-0 text-(--t-text-dim)">{item.identity.username}</span>
            </>}
          />
        );
      case "action":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon={item.icon} />}
            label={item.label}
            detail={item.description}
            trailing={item.keybinding && (
              <kbd className="text-xs px-1.5 py-0.5 rounded-sm shrink-0 font-mono bg-(--t-bg-elevated) text-(--t-text-dim) border border-(--t-border)">
                {item.keybinding}
              </kbd>
            )}
          />
        );
      case "snippet":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon="lucide:braces" accent />}
            label={item.snippet.name}
            detail={<SnippetPreview snippet={item.snippet} />}
            detailMono
            trailing={<>
              <VaultBadge vaultId={item.snippet.vault_id} />
              {item.snippet.tags.length > 0 && (
                <span className="text-xs shrink-0 text-(--t-text-dim)">{item.snippet.tags[0]}</span>
              )}
            </>}
          />
        );
      case "toggle":
        return (
          <OmniRow
            {...row}
            checked={item.value}
            disabled={item.locked}
            leading={<OmniTile icon={item.icon} />}
            label={item.label}
            detail={item.description}
            trailing={
              <span
                aria-hidden="true"
                className="shrink-0 rounded-full transition-colors relative border border-(--t-border)"
                style={{ width: "2.4rem", height: "1.333rem", background: item.value ? "var(--t-accent)" : "var(--t-bg-input)" }}
              >
                <span
                  className="absolute rounded-full bg-white transition-transform"
                  style={{
                    width: "1.067rem",
                    height: "1.067rem",
                    top: "1px",
                    left: "0.067rem",
                    transform: item.value ? "translateX(1.067rem)" : "translateX(0)",
                  }}
                />
              </span>
            }
          />
        );
      case "team-session": {
        const { session, alreadyIn } = item;
        return (
          <OmniRow
            {...row}
            leading={
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--t-accent) 80%, #000)", color: "#fff" }}
              >
                <Icon icon="lucide:radio" width={13} />
              </div>
            }
            label={sessionDisplayName(session)}
            trailing={<>
              <span className="text-xs shrink-0 text-(--t-text-dim)">
                {t("omni.participantCount", { count: session.participant_count })}
              </span>
              <span
                className="text-xs shrink-0 px-1.5 py-0.5 rounded-sm font-medium"
                style={{
                  background: alreadyIn ? "color-mix(in srgb, var(--t-accent) 20%, transparent)" : "var(--t-bg-elevated)",
                  color: alreadyIn ? "var(--t-accent)" : "var(--t-text-dim)",
                }}
              >
                {alreadyIn ? t("omni.resume") : t("omni.join")}
              </span>
            </>}
          />
        );
      }
      case "join-code-prompt":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon="lucide:link" />}
            label={t("omni.joinCodePrompt.title")}
            detail={t("omni.joinCodePrompt.subtitle")}
          />
        );
      case "join-code":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon="lucide:log-in" accent />}
            label={t("omni.joinCodeEntered.title")}
            detail={item.code}
            detailMono
          />
        );
      case "local-shell": {
        const shell = item.shell;
        const label = shell ? shellLabel(shell.name) : t("omni.localShellDefault");
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon={shell ? shellIcon(shell.name) : "lucide:square-terminal"} accent />}
            label={label}
            detail={shell && shellNeedsPath.has(label) ? shell.path : undefined}
            detailMono
          />
        );
      }
      case "quick-connect": {
        const intent = item.intent;
        const { title, subtitle, icon } =
          intent.kind === "ssh"
            ? {
                title: intent.user
                  ? t("omni.quickConnect.connectTo", { user: intent.user, host: intent.host })
                  : t("omni.quickConnect.connectToHost", { host: intent.host }),
                subtitle: t("omni.quickConnect.portSsh", { port: intent.port }),
                icon: "lucide:arrow-right",
              }
            : intent.kind === "serial"
            ? { title: t("omni.quickConnect.serialConnection"), subtitle: intent.port ?? t("omni.quickConnect.configurePortAndBaud"), icon: "lucide:ethernet-port" }
            : { title: intent.shell ? t("omni.quickConnect.localShellNamed", { shell: intent.shell }) : t("omni.quickConnect.localShell"), subtitle: t("omni.quickConnect.openLocalTerminal"), icon: "lucide:square-terminal" };
        return <OmniRow {...row} leading={<OmniTile icon={icon} accent />} label={title} detail={subtitle} />;
      }
      case "plugin":
        return (
          <OmniRow
            {...row}
            leading={<OmniTile icon={catalogEntryIcon(item.plugin)} accent />}
            label={item.plugin.name}
            detail={item.plugin.description}
            trailing={<span className="text-xs shrink-0 text-(--t-text-dim)">{t("omni.pluginNotInstalled")}</span>}
          />
        );
    }
  }

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-60 flex items-start justify-center pt-[20vh]"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(10px) saturate(1.2)",
        WebkitBackdropFilter: "blur(10px) saturate(1.2)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("omni.dialogLabel")}
        className="surface-glass-solid w-full max-w-xl rounded-[var(--r-lg)] overflow-hidden animate-fadeIn mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-b-(--t-border)">
          <Icon icon="lucide:search" width={16} className="text-(--t-accent) shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-label={t("omni.dialogLabel")}
            aria-expanded={omniView === "root"}
            aria-controls={omniView === "root" ? "omni-listbox" : undefined}
            aria-autocomplete="list"
            aria-activedescendant={omniView === "root" && selectedItem ? rowId(selected) : undefined}
            placeholder={omniView === "theme-switch" ? t("omni.theme.searchThemes") : t("omni.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm outline-hidden text-(--t-text-primary) placeholder:text-(--t-text-dim)"
          />
        </div>

        {omniView === "root" && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-b-(--t-border)">
            {SCOPES.map((s) => {
              const isActive = scope === s.category;
              return (
                <button
                  key={s.category}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={isActive}
                  onClick={() => { setScope(s.category); inputRef.current?.focus(); }}
                  className="flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded-sm text-xs transition-colors border"
                  style={{
                    background: isActive ? "var(--t-accent)" : "var(--t-bg-base)",
                    color: isActive ? "var(--t-bg-terminal)" : "var(--t-text-dim)",
                    borderColor: isActive ? "var(--t-accent)" : "var(--t-border)",
                  }}
                >
                  {t(`omni.categoryBadges.${s.category}`)}
                  {s.prefix && <span className="font-mono opacity-75">{s.prefix}</span>}
                </button>
              );
            })}
          </div>
        )}

        {omniView === "theme-switch" ? (
          <OmniThemeSwitch query={q} onBack={() => { setOmniView("root"); setQuery(""); }} onClose={onClose} />
        ) : omniView === "theme-automation" ? (
          <OmniThemeAutomation onBack={() => { setOmniView("root"); setQuery(""); }} onClose={onClose} />
        ) : (
          <>
            <div
              ref={listRef}
              id="omni-listbox"
              role="listbox"
              aria-label={t("omni.dialogLabel")}
              className="overflow-y-auto py-1.5"
              style={{ maxHeight: "420px" }}
            >
              {groups.map((g, gi) => (
                <Fragment key={`${g.section}-${g.start}`}>
                  {gi > 0 && <div role="presentation" className="border-t border-t-(--t-border) my-1.5" />}
                  <p role="presentation" aria-hidden="true" className="px-4 pt-1 pb-1.5 text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                    {t(`omni.sections.${g.section}`)}
                  </p>
                  {g.items.map((item, j) => renderItem(item, g.start + j))}
                </Fragment>
              ))}
              {items.length === 0 && (
                <p className="px-4 py-6 text-sm text-center text-(--t-text-dim)">{emptyText}</p>
              )}
            </div>
            <div className="border-t border-t-(--t-border) px-4 py-2 flex items-center gap-4 text-xs text-(--t-text-dim)">
              <KeyHint keys="↑↓" label={t("omni.hints.move")} />
              <KeyHint keys="↵" label={t("omni.hints.open")} />
              {selectedItem?.kind === "host" && <KeyHint keys="⇧↵" label={t("omni.hints.edit")} />}
              <KeyHint keys="Tab" label={t("omni.hints.scope")} />
              <span className="ml-auto"><KeyHint keys="Esc" label={t("omni.hints.close")} /></span>
            </div>
          </>
        )}
        <div className="sr-only" aria-live="polite">{omniView === "root" ? liveText : ""}</div>
      </div>
    </div>,
    document.body,
  );
}
