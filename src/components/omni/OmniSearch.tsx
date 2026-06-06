import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
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
import { broadcastSnippetInject } from "@/services/snippets";
import type { Connection, TerminalSession, SshKey, Identity, Snippet } from "@/types";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { SETTINGS_NAV } from "@/components/settings/settingsNav";
import { useShortcutStore, formatShortcut } from "@/stores/shortcutStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { ActiveSession } from "@/stores/teamSessionStore";
import { getCurrentUserEmail } from "@/services/account";
import { useToggleSettings } from "@/hooks/useToggleSettings";

interface OmniSearchProps {
  onClose: () => void;
}

type OmniItem =
  | { kind: "host"; connection: Connection }
  | { kind: "session"; session: TerminalSession; connection: Connection | undefined }
  | { kind: "key"; key: SshKey }
  | { kind: "identity"; identity: Identity }
  | { kind: "action"; id: string; label: string; icon: string; description?: string; keybinding?: string }
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "team-session"; session: ActiveSession; alreadyIn: boolean }
  | { kind: "toggle"; id: string; label: string; icon: string; description?: string; keywords?: string[]; value: boolean; onToggle: (v: boolean) => void }
  | { kind: "ssh-quick"; id: string; label: string; icon: string; user: string; host: string; port: number }
  | { kind: "join-code"; id: string; label: string; icon: string; code: string }
  | { kind: "join-code-prompt"; id: string; label: string; icon: string };

type Category = "all" | "snippets" | "marketplace" | "settings" | "ssh" | "join";

const CATEGORY_BADGES: { category: Category; prefix: string; label: string }[] = [
  { category: "all",         prefix: "",      label: "All" },
  { category: "join",        prefix: "join ", label: "join> Sessions" },
  { category: "snippets",    prefix: "> ",    label: "> Snippets" },
  { category: "marketplace", prefix: "m> ",   label: "m> Marketplace" },
  { category: "settings",    prefix: "@ ",    label: "@ Settings" },
];

function detectCategory(raw: string): { category: Category; query: string } {
  if (raw.startsWith("m> "))   return { category: "marketplace", query: raw.slice(3) };
  if (raw.startsWith("> "))    return { category: "snippets",    query: raw.slice(2) };
  if (raw.startsWith("@ "))    return { category: "settings",    query: raw.slice(2) };
  if (raw.startsWith("ssh "))  return { category: "ssh",         query: raw.slice(4) };
  if (raw.startsWith("join ")) return { category: "join",        query: raw.slice(5) };
  return { category: "all", query: raw };
}

function parseSshTarget(raw: string): { user: string; host: string; port: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const atIdx = trimmed.indexOf("@");
  const user = atIdx >= 0 ? trimmed.slice(0, atIdx) : "";
  const rest = atIdx >= 0 ? trimmed.slice(atIdx + 1) : trimmed;
  const colonIdx = rest.indexOf(":");
  const host = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
  const port = colonIdx >= 0 ? parseInt(rest.slice(colonIdx + 1), 10) || 22 : 22;
  if (!host) return null;
  return { user: user || "root", host, port };
}


function HostAvatar({ connection, size = 28 }: { connection: Connection; size?: number }) {
  const displayIcon = connection.icon || connection.distro;
  const distroIcon = displayIcon ? getConnectionIcon(displayIcon) : null;
  const distroBg = displayIcon ? getConnectionIconColor(displayIcon) : null;
  const iconSize = Math.round(size * 0.57);
  if (distroIcon) {
    return (
      <div
        className="rounded-lg flex items-center justify-center shrink-0"
        style={{ background: distroBg ?? "var(--t-bg-terminal)", color: "#fff", width: size, height: size }}
      >
        <Icon icon={distroIcon} width={iconSize} />
      </div>
    );
  }
  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0"
      style={{ background: "var(--t-bg-card-avatar)", color: "#fff", width: size, height: size }}
    >
      <Icon icon="lucide:server" width={iconSize} />
    </div>
  );
}

function VaultBadge({ vaultId, vaults, teams }: { vaultId: string | undefined; vaults: import("@/stores/vaultStore").Vault[]; teams: import("@/stores/teamStore").Team[] }) {
  const effectiveId = vaultId ?? "personal";
  const vault = vaults.find((v) => v.id === effectiveId || v.teamId === effectiveId);
  const team = !vault ? teams.find((t) => t.id === effectiveId) : undefined;
  const name = vault?.name ?? team?.name ?? "Personal";
  const isPersonal = effectiveId === "personal";
  return (
    <span
      className="shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm border"
      style={isPersonal
        ? { background: "var(--t-bg-elevated)", color: "var(--t-text-muted)", borderColor: "var(--t-border)" }
        : { background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", color: "var(--t-accent)", borderColor: "color-mix(in srgb, var(--t-accent) 30%, transparent)" }
      }
    >
      <Icon icon="lucide:vault" width={10} />
      {name}
    </span>
  );
}

export default function OmniSearch({ onClose }: OmniSearchProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const connections = useAllConnections();
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const { sessions, setActive, connect, connectDirect } = useSessionStore();
  const snippets = useSnippetStore((s) => s.snippets);
  const { trackUsed, setGlobalPendingInject } = useSnippetStore();
  const identities = useIdentityStore((s) => s.identities);
  const keys = useKeyStore((s) => s.keys);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const { activeSessions: teamSessions, fetchActiveSessions, joinSession } = useTeamSessionStore();
  const mpConnections = useTeamSessionStore((s) => s.connections);
  const myMpSessionIds = useMemo(
    () => new Set(Object.values(mpConnections).map((c) => c.multiplayerSessionId)),
    [mpConnections],
  );
  const omniCommandsMap = usePluginStore((s) => s.omniCommands);
  const pluginCommands = useMemo(() => [...omniCommandsMap.values()], [omniCommandsMap]);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const settingsPagesMap = usePluginStore((s) => s.settingsPages);

  const settingsItems = useMemo<OmniItem[]>(() => {
    const base = SETTINGS_NAV.map((n): OmniItem => ({
      kind: "action",
      id: `open-settings:${n.id}`,
      label: n.label,
      icon: n.icon,
      description: "Settings",
    }));
    const pluginPages = [...settingsPagesMap.values()].map((p): OmniItem => ({
      kind: "action",
      id: `open-settings:plugin:${p.id}`,
      label: p.label,
      icon: p.icon,
      description: "Plugin Settings",
    }));
    return [...base, ...pluginPages];
  }, [settingsPagesMap]);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const setHomePendingAction = useUIStore((s) => s.setHomePendingAction);
  const setKeychainPendingAction = useUIStore((s) => s.setKeychainPendingAction);

  // Toggle settings subscriptions
  const toggleSettings = useToggleSettings();
  const toggleItems = useMemo<OmniItem[]>(
    () => toggleSettings.map(({ id, ...d }) => ({ kind: "toggle" as const, id: `toggle:${id}`, ...d })),
    [toggleSettings],
  );

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { fetchActiveSessions().catch(() => {}); }, [fetchActiveSessions]);

  const { category, query: q } = useMemo(() => {
    const parsed = detectCategory(query);
    return { category: parsed.category, query: parsed.query.toLowerCase().trim() };
  }, [query]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === "connected" || s.status === "connecting"),
    [sessions],
  );

  const activeConnectionIds = useMemo(
    () => new Set(activeSessions.map((s) => s.connectionId)),
    [activeSessions],
  );

  const recentConnections = useMemo(
    () => [...connections]
      .filter((c) => c.last_used_at && !activeConnectionIds.has(c.id))
      .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "")),
    [activeConnectionIds, connections],
  );

  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );

  const items: OmniItem[] = useMemo(() => {
    if (category === "settings") {
      const navItems = settingsItems.filter((a) => {
        if (!q) return true;
        if (a.kind !== "action") return false;
        if (a.label.toLowerCase().includes(q)) return true;
        const navEntry = SETTINGS_NAV.find((n) => `open-settings:${n.id}` === a.id);
        return navEntry?.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false;
      });
      const filteredToggles = toggleItems.filter((t) =>
        t.kind === "toggle" && (!q || t.label.toLowerCase().includes(q) || t.keywords?.some((k) => k.toLowerCase().includes(q))),
      );
      return [...navItems, ...filteredToggles];
    }
    if (category === "snippets") {
      return snippets
        .filter((s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
        )
        .map((s): OmniItem => ({ kind: "snippet", snippet: s }));
    }
    if (category === "marketplace") return [];
    if (category === "ssh") {
      const target = parseSshTarget(q);
      return target ? [{ kind: "ssh-quick", id: "", label: "", icon: "", ...target }] : [];
    }
    if (category === "join") {
      if (q.includes(":")) {
        return [{ kind: "join-code", id: "", label: "", icon: "", code: q }];
      }
      const sessionItems = teamSessions
        .filter((s) => !q || s.connection_name.toLowerCase().includes(q))
        .map((s): OmniItem => ({ kind: "team-session", session: s, alreadyIn: myMpSessionIds.has(s.id) }));
      return [...sessionItems, { kind: "join-code-prompt", id: "", label: "", icon: "" }];
    }

    const result: OmniItem[] = [];

    // Active SSH sessions
    result.push(
      ...activeSessions
        .filter((s) => !q || s.connectionName.toLowerCase().includes(q))
        .map((s): OmniItem => ({ kind: "session", session: s, connection: connectionById.get(s.connectionId) })),
    );

    // Active team sessions
    result.push(
      ...teamSessions
        .filter((s) => !q || s.connection_name.toLowerCase().includes(q))
        .map((s): OmniItem => ({ kind: "team-session", session: s, alreadyIn: myMpSessionIds.has(s.id) })),
    );

    // Recent (only when no query)
    if (!q) {
      result.push(...recentConnections.map((c): OmniItem => ({ kind: "host", connection: c })));
    }

    // Hosts
    const filteredHosts = connections.filter((c) => {
      if (q) {
        return (c.name ?? "").toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q);
      }
      return !activeConnectionIds.has(c.id) && !c.last_used_at;
    });
    result.push(...filteredHosts.map((c): OmniItem => ({ kind: "host", connection: c })));

    // SSH Keys
    result.push(
      ...keys
        .filter((k) => !q || (k.name ?? "").toLowerCase().includes(q) || (k.key_type ?? "").toLowerCase().includes(q))
        .map((k): OmniItem => ({ kind: "key", key: k })),
    );

    // Identities
    result.push(
      ...identities
        .filter((i) => !q || (i.name ?? "").toLowerCase().includes(q) || i.username.toLowerCase().includes(q))
        .map((i): OmniItem => ({ kind: "identity", identity: i })),
    );

    // Snippets
    if (q) {
      result.push(
        ...snippets
          .filter((s) =>
            s.name.toLowerCase().includes(q) ||
            s.content.toLowerCase().includes(q) ||
            s.tags.some((t) => t.toLowerCase().includes(q)),
          )
          .map((s): OmniItem => ({ kind: "snippet", snippet: s })),
      );
    }

    // Plugin + core commands
    const filteredPluginCmds = pluginCommands.filter((cmd) => {
      if (!q) return true;
      return cmd.label.toLowerCase().includes(q) ||
        cmd.keywords?.some((k) => k.toLowerCase().includes(q));
    });
    result.push(
      ...filteredPluginCmds.map((cmd): OmniItem => {
        let keybinding = cmd.keybinding;
        if (!keybinding && cmd.shortcutId) {
          const sc = shortcuts.find((s) => s.id === cmd.shortcutId);
          if (sc) keybinding = formatShortcut(sc);
        }
        return {
          kind: "action",
          id: `plugin:${cmd.id}`,
          label: cmd.label,
          icon: cmd.icon,
          description: cmd.section,
          keybinding,
        };
      }),
    );

    // Toggle settings (only when query matches — avoids flooding the empty state)
    if (q) {
      result.push(
        ...toggleItems.filter((t) =>
          t.kind === "toggle" && (t.label.toLowerCase().includes(q) || t.keywords?.some((k) => k.toLowerCase().includes(q))),
        ),
      );
    }

    // Settings pages (only when query matches — avoids flooding the empty state)
    if (q) {
      result.push(
        ...settingsItems.filter((a) => {
          if (a.kind !== "action") return false;
          if (a.label.toLowerCase().includes(q)) return true;
          const navEntry = SETTINGS_NAV.find((n) => `open-settings:${n.id}` === a.id);
          return navEntry?.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false;
        }),
      );
    }

    return result;
  }, [category, q, activeSessions, recentConnections, connections, activeConnectionIds, keys, identities, connectionById, pluginCommands, settingsItems, snippets, shortcuts, teamSessions, myMpSessionIds, toggleItems]);

  const clamp = useCallback(
    (idx: number) => Math.max(0, Math.min(idx, items.length - 1)),
    [items.length],
  );

  useEffect(() => { setSelected(0); }, [query]);

  const selectItem = useCallback(
    (item: OmniItem) => {
      if (item.kind === "host") {
        connect(item.connection.id).catch(() => {});
        setSidebarOpen(false);
        setActiveNav("terminal");
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
        if (item.id.startsWith("plugin:")) {
          const cmdId = item.id.slice("plugin:".length);
          pluginCommands.find((c) => c.id === cmdId)?.execute();
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
        const activeSession = sessions.find(
          (s) => s.status === "connected" && s.type !== "multiplayer",
        );
        if (!activeSession) { onClose(); return; }

        const conn = connections.find((c) => c.id === activeSession.connectionId);
        const ctx: DynamicContext = activeSession.type === "local"
          ? { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell" }
          : { connectionHost: conn?.host ?? "", connectionUsername: conn?.username ?? "", connectionName: activeSession.connectionName };

        const allVars = parseVariables(item.snippet.content);
        const dynamicValues = buildDynamicValues(allVars, ctx);
        const userVars = allVars.filter((v) => !v.dynamic);
        const defaultValues = buildDefaultValues(userVars);
        const partialTemplate = resolveTemplate(item.snippet.content, dynamicValues);

        trackUsed(item.snippet.id);
        onClose();

        if (userVars.some(needsUserInput)) {
          setGlobalPendingInject({
            snippet: item.snippet,
            userVars,
            partialTemplate,
            initialValues: defaultValues,
          });
        } else {
          const resolved = resolveTemplate(partialTemplate, defaultValues);
          broadcastSnippetInject(activeSession.id, activeSession.type, resolved, true).catch(console.error);
        }
      } else if (item.kind === "toggle") {
        item.onToggle(!item.value);
        // Stay in palette so the user can see the updated state
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
            const displayName = (await getCurrentUserEmail()) ?? "Me";
            const localSessionId = await joinSession(session.id, displayName, () => {});
            useSessionStore.setState((s) => ({
              sessions: [
                ...s.sessions,
                {
                  id: localSessionId,
                  connectionId: session.id,
                  connectionName: session.connection_name,
                  status: "connected" as const,
                  type: "multiplayer" as const,
                },
              ],
              activeSessionId: localSessionId,
            }));
            setSidebarOpen(false);
            setActiveNav("terminal");
          })().catch(console.error);
        }
        onClose();
      } else if (item.kind === "join-code-prompt") {
        inputRef.current?.focus();
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
          }
        }, 0);
      } else if (item.kind === "join-code") {
        const code = item.code;
        const colonIdx = code.indexOf(":");
        if (colonIdx !== -1) {
          const sessionId = code.slice(0, colonIdx);
          const token = code.slice(colonIdx + 1);
          if (sessionId && token) {
            (async () => {
              const displayName = (await getCurrentUserEmail()) ?? "Me";
              const localSessionId = await joinSession(sessionId, displayName, () => {}, token);
              useSessionStore.setState((s) => ({
                sessions: [
                  ...s.sessions,
                  {
                    id: localSessionId,
                    connectionId: sessionId,
                    connectionName: "Shared Terminal",
                    status: "connected" as const,
                    type: "multiplayer" as const,
                  },
                ],
                activeSessionId: localSessionId,
              }));
              setSidebarOpen(false);
              setActiveNav("terminal");
            })().catch(console.error);
          }
        }
        onClose();
      } else if (item.kind === "ssh-quick") {
        const i = item;
        connectDirect({
          id: crypto.randomUUID(),
          name: `${i.user}@${i.host}`,
          host: i.host,
          port: i.port,
          username: i.user,
          auth_type: "password",
          tags: [],
          vault_id: "personal",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_used_at: null,
          clocks: {},
        }).catch(() => {});
        setSidebarOpen(false);
        setActiveNav("terminal");
        onClose();
      }
    },
    [connect, connectDirect, setActive, setActiveNav, onClose, setSidebarOpen,
     openSettings, setHomePendingAction, setKeychainPendingAction, pluginCommands,
     sessions, connections, trackUsed, setGlobalPendingInject, joinSession],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => clamp(s + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => clamp(s - 1)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selected];
        if (item) selectItem(item);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [items, selected, clamp, selectItem, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const sectionBoundaries = useMemo(() => {
    if (category !== "all") return null;
    let idx = 0;
    const activeCount = items.filter((i) => i.kind === "session").length;
    const activeStart = idx; idx += activeCount;

    const teamSessionCount = items.filter((i) => i.kind === "team-session").length;
    const teamSessionStart = idx; idx += teamSessionCount;

    const recentCount = !q ? recentConnections.length : 0;
    const recentStart = idx; idx += recentCount;

    const hostCount = items.filter((i) => i.kind === "host").length - recentCount;
    const hostStart = idx; idx += hostCount;

    const keyCount = items.filter((i) => i.kind === "key").length;
    const keyStart = idx; idx += keyCount;

    const identityCount = items.filter((i) => i.kind === "identity").length;
    const identityStart = idx; idx += identityCount;

    const snippetCount = items.filter((i) => i.kind === "snippet").length;
    const snippetStart = idx; idx += snippetCount;

    const settingsCount = items.filter((i) => i.kind === "action" && i.id.startsWith("open-settings:")).length;
    const actionCount = items.filter((i) => i.kind === "action" && !i.id.startsWith("open-settings:")).length;
    const toggleCount = items.filter((i) => i.kind === "toggle").length;
    const actionStart = idx; idx += actionCount;
    const toggleStart = idx; idx += toggleCount;
    const settingsStart = idx;

    return { activeStart, activeCount, teamSessionStart, teamSessionCount, recentStart, recentCount, hostStart, hostCount, keyStart, keyCount, identityStart, identityCount, snippetStart, snippetCount, actionStart, actionCount, toggleStart, toggleCount, settingsStart, settingsCount };
  }, [category, items, q, recentConnections.length]);

  const statusColor = (s: TerminalSession) =>
    s.status === "connected"  ? "var(--t-status-connected)" :
    s.status === "error"      ? "var(--t-status-error)" :
    s.status === "connecting" ? "var(--t-status-connecting)" :
                                "var(--t-text-muted)";

  function renderItem(item: OmniItem, idx: number) {
    const isSelected = selected === idx;
    const baseBg = isSelected ? "var(--t-border-hover)" : "transparent";

    if (item.kind === "session") {
      const conn = item.connection;
      return (
        <button
          key={`s-${item.session.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          {conn ? (
            <div className="relative shrink-0">
              <HostAvatar connection={conn} size={28} />
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-(--t-bg-modal)"
                style={{ background: statusColor(item.session) }}
              />
            </div>
          ) : (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor(item.session) }} />
          )}
          <span className="flex-1 min-w-0 text-sm font-semibold truncate"
            style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
            {item.session.connectionName}
          </span>
          <VaultBadge vaultId={item.connection?.vault_id} vaults={vaults} teams={teams} />
          <span className="text-xs shrink-0 text-(--t-text-dim)">
            {item.session.status}
          </span>
        </button>
      );
    }

    if (item.kind === "host") {
      const conn = item.connection;
      return (
        <button
          key={`h-${conn.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors group/row"
          style={{ background: baseBg }}
        >
          <HostAvatar connection={conn} size={28} />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {conn.name || `${conn.username}@${conn.host}`}
            </span>
          </div>
          <VaultBadge vaultId={conn.vault_id} vaults={vaults} teams={teams} />
          <span className="text-xs shrink-0 group-hover/row:hidden text-(--t-text-muted)">
            ssh, {conn.username}
          </span>
          {/* Inline actions on hover */}
          <div className="hidden group-hover/row:flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setHomePendingAction({ action: "edit", id: conn.id }); setActiveNav("hosts"); onClose(); }}
              className="p-1.5 rounded-md transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
              title="Edit host"
            >
              <Icon icon="lucide:pencil" width={13} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteConnection(conn.id).catch(() => {}); }}
              className="p-1.5 rounded-md transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { e.currentTarget.style.background = "#3D1515"; e.currentTarget.style.color = "#F87171"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
              title="Delete host"
            >
              <Icon icon="lucide:trash-2" width={13} />
            </button>
          </div>
        </button>
      );
    }

    if (item.kind === "key") {
      return (
        <button
          key={`k-${item.key.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-card-avatar)">
            <Icon icon="lucide:key-round" width={13} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {item.key.name}
            </span>
          </div>
          <VaultBadge vaultId={item.key.vault_id} vaults={vaults} teams={teams} />
          {item.key.key_type && (
            <span className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded-sm bg-(--t-bg-elevated) text-(--t-accent)">
              {item.key.key_type}
            </span>
          )}
        </button>
      );
    }

    if (item.kind === "identity") {
      return (
        <button
          key={`i-${item.identity.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-card-avatar)">
            <Icon icon="lucide:id-card" width={13} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {item.identity.name ?? item.identity.username}
            </span>
          </div>
          <VaultBadge vaultId={item.identity.vault_id} vaults={vaults} teams={teams} />
          <span className="text-xs shrink-0 text-(--t-text-muted)">
            {item.identity.username}
          </span>
        </button>
      );
    }

    if (item.kind === "action") {
      return (
        <button
          key={`a-${item.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
            <Icon icon={item.icon} width={13} className="text-(--t-text-muted)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {item.label}
            </span>
            {item.description && (
              <p className="text-xs mt-0.5 text-(--t-text-dim)">
                {item.description}
              </p>
            )}
          </div>
          {item.keybinding && (
            <span className="text-xs px-1.5 py-0.5 rounded-sm shrink-0 font-mono bg-(--t-bg-elevated) text-(--t-text-dim) border border-(--t-border)">
              {item.keybinding}
            </span>
          )}
        </button>
      );
    }

    if (item.kind === "snippet") {
      return (
        <button
          key={`sn-${item.snippet.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-card-avatar)">
            <Icon icon="lucide:braces" width={13} className="text-(--t-accent)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {item.snippet.name}
            </span>
            <p className="text-xs mt-0.5 font-mono truncate text-(--t-text-dim)">
              {item.snippet.content}
            </p>
          </div>
          <VaultBadge vaultId={item.snippet.vault_id} vaults={vaults} teams={teams} />
          {item.snippet.tags.length > 0 && (
            <span className="text-[10px] shrink-0 text-(--t-text-muted)">
              {item.snippet.tags[0]}
            </span>
          )}
        </button>
      );
    }

    if (item.kind === "toggle") {
      const isOn = item.value;
      return (
        <button
          key={`t-${item.id}`}
          data-idx={idx}
          onClick={() => item.onToggle(!item.value)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
            <Icon icon={item.icon} width={13} className="text-(--t-text-muted)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {item.label}
            </span>
            {item.description && (
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{item.description}</p>
            )}
          </div>
          <div
            className="shrink-0 rounded-full transition-colors"
            style={{
              width: "2.4rem",
              height: "1.333rem",
              background: isOn ? "var(--t-accent)" : "var(--t-bg-input)",
              border: "1px solid var(--t-border)",
              position: "relative",
            }}
          >
            <span
              className="absolute rounded-full bg-white transition-transform"
              style={{
                width: "1.067rem",
                height: "1.067rem",
                top: "1px",
                left: "0.067rem",
                transform: isOn ? "translateX(1.067rem)" : "translateX(0)",
              }}
            />
          </div>
        </button>
      );
    }

    if (item.kind === "team-session") {
      const { session, alreadyIn } = item;
      return (
        <button
          key={`ts-${session.id}`}
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 80%, #000)", color: "#fff" }}
          >
            <Icon icon="lucide:radio" width={13} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {session.connection_name}
            </span>
          </div>
          <span className="text-xs shrink-0 text-(--t-text-dim)">
            {session.participant_count} {session.participant_count === 1 ? "person" : "people"}
          </span>
          <span
            className="text-xs shrink-0 px-1.5 py-0.5 rounded-sm font-medium"
            style={{
              background: alreadyIn ? "color-mix(in srgb, var(--t-accent) 20%, transparent)" : "var(--t-bg-elevated)",
              color: alreadyIn ? "var(--t-accent)" : "var(--t-text-dim)",
            }}
          >
            {alreadyIn ? "Resume" : "Join"}
          </span>
        </button>
      );
    }

    // join-code-prompt — always visible in join mode to surface the invite code flow
    if (item.kind === "join-code-prompt") {
      return (
        <button
          key="join-code-prompt"
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
            <Icon icon="lucide:link" width={13} className="text-(--t-text-muted)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              Join by invite code...
            </span>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">
              Paste your invite code here to join a private session
            </p>
          </div>
        </button>
      );
    }

    // join-code (entered via "join " prefix)
    if (item.kind === "join-code") {
      return (
        <button
          key="join-code"
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
            <Icon icon="lucide:log-in" width={13} className="text-(--t-accent)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              Join by invite code
            </span>
            <p className="text-xs mt-0.5 font-mono truncate text-(--t-text-dim)">
              {item.code}
            </p>
          </div>
        </button>
      );
    }

    // ssh-quick
    if (item.kind === "ssh-quick") {
      return (
        <button
          key="ssh-quick"
          data-idx={idx}
          onClick={() => selectItem(item)}
          onMouseEnter={() => setSelected(idx)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
          style={{ background: baseBg }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
            <Icon icon="lucide:arrow-right" width={13} className="text-(--t-accent)" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              Connect to {item.user}@{item.host}
            </span>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">
              Port {item.port} — quick SSH connection
            </p>
          </div>
        </button>
      );
    }

    return null;
  }

  function sectionHeader(label: string, showDivider: boolean) {
    return (
      <>
        {showDivider && (
          <div className="border-t border-t-(--t-border) my-1" />
        )}
        <p className="px-4 pt-1 pb-1.5 text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
          {label}
        </p>
      </>
    );
  }

  let runningIdx = 0;
  const hasAbove = (...counts: number[]) => counts.some((c) => c > 0);

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-start justify-center pt-24"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden shadow-2xl bg-(--t-bg-modal) border border-(--t-border-hover) animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-b-(--t-border)">
          <Icon icon="lucide:search" width={16}
            className="text-(--t-accent) shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hosts, keys, identities & commands..."
            className="flex-1 bg-transparent text-sm outline-hidden placeholder-opacity-40 text-(--t-text-primary)"
          />
          <span className="text-xs px-1.5 py-0.5 rounded-lg font-mono bg-(--t-bg-base) text-(--t-text-muted) border border-(--t-border-hover)">
            Ctrl+K
          </span>
        </div>

        {/* Category badges */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-b-(--t-border)">
          {CATEGORY_BADGES.map((badge) => {
            const isActive = category === badge.category;
            return (
              <button
                key={badge.category}
                onClick={() => {
                  setQuery(badge.prefix);
                  inputRef.current?.focus();
                }}
                className="px-2 py-0.5 rounded-sm text-xs font-mono transition-colors"
                style={{
                  background: isActive ? "var(--t-accent)" : "var(--t-bg-base)",
                  color: isActive ? "var(--t-bg-terminal)" : "var(--t-text-muted)",
                  border: `1px solid ${isActive ? "var(--t-accent)" : "var(--t-border)"}`,
                }}
              >
                {badge.label}
              </button>
            );
          })}
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto py-2" style={{ maxHeight: "420px" }}>
          {category === "all" && sectionBoundaries ? (
            <>
              {sectionBoundaries.activeCount > 0 && (
                <>
                  {sectionHeader("Active connections", false)}
                  {items.slice(sectionBoundaries.activeStart, sectionBoundaries.activeStart + sectionBoundaries.activeCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.teamSessionCount > 0 && (
                <>
                  {sectionHeader("Team Sessions", sectionBoundaries.activeCount > 0)}
                  {items.slice(sectionBoundaries.teamSessionStart, sectionBoundaries.teamSessionStart + sectionBoundaries.teamSessionCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.recentCount > 0 && (
                <>
                  {sectionHeader("Recent", sectionBoundaries.activeCount > 0)}
                  {items.slice(sectionBoundaries.recentStart, sectionBoundaries.recentStart + sectionBoundaries.recentCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.hostCount > 0 && (
                <>
                  {sectionHeader("Hosts", hasAbove(sectionBoundaries.activeCount, sectionBoundaries.recentCount))}
                  {items.slice(sectionBoundaries.hostStart, sectionBoundaries.hostStart + sectionBoundaries.hostCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {(sectionBoundaries.keyCount > 0 || sectionBoundaries.identityCount > 0) && (
                <>
                  {sectionHeader("Keychain", hasAbove(sectionBoundaries.activeCount, sectionBoundaries.recentCount, sectionBoundaries.hostCount))}
                  {items.slice(sectionBoundaries.keyStart, sectionBoundaries.keyStart + sectionBoundaries.keyCount)
                    .map((item) => renderItem(item, runningIdx++))}
                  {items.slice(sectionBoundaries.identityStart, sectionBoundaries.identityStart + sectionBoundaries.identityCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.snippetCount > 0 && (
                <>
                  {sectionHeader("Snippets", runningIdx > 0)}
                  {items.slice(sectionBoundaries.snippetStart, sectionBoundaries.snippetStart + sectionBoundaries.snippetCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.actionCount > 0 && (
                <>
                  {sectionHeader("Actions", runningIdx > 0)}
                  {items.slice(sectionBoundaries.actionStart, sectionBoundaries.actionStart + sectionBoundaries.actionCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.toggleCount > 0 && (
                <>
                  {sectionHeader("Quick Settings", runningIdx > 0)}
                  {items.slice(sectionBoundaries.toggleStart, sectionBoundaries.toggleStart + sectionBoundaries.toggleCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}

              {sectionBoundaries.settingsCount > 0 && (
                <>
                  {sectionHeader("Settings", runningIdx > 0)}
                  {items.slice(sectionBoundaries.settingsStart, sectionBoundaries.settingsStart + sectionBoundaries.settingsCount)
                    .map((item) => renderItem(item, runningIdx++))}
                </>
              )}
            </>
          ) : (
            <>
              {category === "settings" && sectionHeader("Settings", false)}
              {category === "ssh" && items.length > 0 && sectionHeader("Quick connect", false)}
              {category === "join" && items[0]?.kind === "join-code" && sectionHeader("Join by invite code", false)}
              {category === "join" && items[0]?.kind !== "join-code" && sectionHeader("Team Sessions", false)}
              {items.map((item) => renderItem(item, runningIdx++))}
            </>
          )}

          {items.length === 0 && (
            <p className="px-4 py-6 text-sm text-center text-(--t-text-dim)">
              {category === "snippets" ? "No snippets yet" :
               category === "marketplace" ? "Marketplace coming soon" :
               category === "ssh" ? "Type ssh user@host to quick connect" :
               category === "join" ? (q ? `No sessions match "${q}"` : "No active team sessions") :
               `No results for "${q || query}"`}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
