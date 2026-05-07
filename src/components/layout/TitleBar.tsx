import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useThemeStore } from "@/stores/themeStore";
import { getDistroIcon, getDistroColor } from "@/utils/icons";
import { getSyncState, onSyncStateChange, type SyncStatus } from "@/services/sync";
import { getGistSyncState, onGistSyncStateChange } from "@/plugins/gist-sync/sync-engine";
import { getUpdaterState, onUpdaterStateChange, installUpdate, type UpdaterStatus } from "@/services/updater";
import { useRipple } from "@/hooks/useRipple";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { ShareMenu } from "@/components/terminal/ShareMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { usePfToastBridge } from "@/hooks/usePfToastBridge";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { SyncDropdown } from "@/components/layout/SyncDropdown";
import { useDragStore } from "@/stores/dragStore";
import { findLeaf, firstLeaf, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { shouldSuppressDragClick } from "@/components/panes/usePaneDragController";
import { mergeTitlebarItems } from "@/utils/titlebarOrder";

const appWindow = getCurrentWindow();

type TitlebarItem =
  | { key: string; type: "split"; tab: ReturnType<typeof useLayoutStore.getState>["splitTabs"][number] }
  | { key: string; type: "session"; session: ReturnType<typeof useSessionStore.getState>["sessions"][number] };

export default function TitleBar() {
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const activeNav = useUIStore((s) => s.activeNav);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const setSftpPanelOpen = useUIStore((s) => s.setSftpPanelOpen);
  const activeThemeName = useThemeStore((s) => s.getActiveTheme().name);
  const { sessions, activeSessionId, setActive, disconnect, removeSession } = useSessionStore();
  const connections = useConnectionStore((s) => s.connections);
  const splitTabs = useLayoutStore((s) => s.splitTabs);
  const activeSplitTabId = useLayoutStore((s) => s.activeSplitTabId);
  const splitTabActive = useLayoutStore((s) => s.splitTabActive);
  const setSplitTabActive = useLayoutStore((s) => s.setSplitTabActive);
  const activateSplitTab = useLayoutStore((s) => s.activateSplitTab);
  const closeSplitTab = useLayoutStore((s) => s.closeSplitTab);
  const titlebarOrder = useLayoutStore((s) => s.titlebarOrder);
  const syncTitlebarOrder = useLayoutStore((s) => s.syncTitlebarOrder);
  const isDraggingTitlebarItem = useDragStore((s) => s.isDragging && s.dragType === "tab");
  const isDraggingPane = useDragStore((s) => s.isDragging && s.dragType === "pane");
  const draggedSessionId = useDragStore((s) => s.sessionId);
  const dropTarget = useDragStore((s) => s.dropTarget);
  const titlebarDropActive = isDraggingPane && dropTarget?.type === "titlebar";

  usePfToastBridge();

  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => { return onSyncStateChange(() => setSyncState(getSyncState())); }, []);

  const [gistSyncState, setGistSyncState] = useState(getGistSyncState);
  useEffect(() => { return onGistSyncStateChange(() => setGistSyncState(getGistSyncState())); }, []);

  const gistPluginEnabled = usePluginRegistryStore((s) => s.isEnabled("plugin-gist-sync", false));

  const effectiveConfigured = syncState.cloudActive || gistSyncState.configured;
  const effectiveSyncStatus = syncState.cloudActive ? syncState.status : gistSyncState.configured ? gistSyncState.status : syncState.status;
  const effectiveLastSync = syncState.cloudActive ? syncState.lastSync : gistSyncState.lastSync;
  const effectiveError = syncState.cloudActive ? syncState.error : gistSyncState.error;

  const [syncDropdownOpen, setSyncDropdownOpen] = useState(false);
  const syncButtonRef = useRef<HTMLButtonElement>(null);

  const [updaterState, setUpdaterState] = useState(getUpdaterState);
  useEffect(() => { return onUpdaterStateChange(() => setUpdaterState(getUpdaterState())); }, []);

  const showTerminal = activeSessionId !== null && sessions.length > 0 && activeNav === ("terminal" as any) && !sftpPanelOpen;
  const isVaultsActive = !sftpPanelOpen && activeNav !== ("terminal" as any);
  const isVaultCompact = !isVaultsActive && sessions.length > 0;

  const mpConnections = useTeamSessionStore((s) => s.connections);
  const leaveMultiplayerSession = useTeamSessionStore((s) => s.leaveSession);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const tier = useSubscriptionStore((s) => s.tier);
  const openSettings = useUIStore((s) => s.openSettings);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isActiveSessionMultiplayer = activeSession?.type === "multiplayer";
  const isActiveSessionSharing = activeSessionId ? !!mpConnections[activeSessionId] && !mpConnections[activeSessionId]?.ended : false;
  const isActiveSessionEnded = activeSessionId ? !!mpConnections[activeSessionId]?.ended : false;

  const isSftpCompact = !sftpPanelOpen && sessions.length > 0;
  const splitSessionIds = splitTabs.flatMap((tab) => getPaneSessionIds(tab.root));
  const splitSessionIdSet = new Set(splitSessionIds);
  const visibleSessions = sessions.filter((session) => !splitSessionIdSet.has(session.id));
  const draggedSession = titlebarDropActive ? sessions.find((session) => session.id === draggedSessionId) : null;
  const splitItems: TitlebarItem[] = splitTabs.map((tab) => ({ key: `split:${tab.id}`, type: "split", tab }));
  const sessionItems: TitlebarItem[] = visibleSessions.map((session) => ({ key: `session:${session.id}`, type: "session", session }));
  const titlebarItemMap = new Map([...splitItems, ...sessionItems].map((item) => [item.key, item]));
  const visibleItemKeys = [...splitItems, ...sessionItems].map((item) => item.key);
  const orderedItemKeys = mergeTitlebarItems(titlebarOrder, visibleItemKeys);
  const titlebarItems = orderedItemKeys.flatMap((key) => {
    const item = titlebarItemMap.get(key);
    return item ? [item] : [];
  });

  useEffect(() => {
    syncTitlebarOrder(visibleItemKeys);
  }, [syncTitlebarOrder, visibleItemKeys.join("|")]);

  const handleTabClick = (sessionId: string) => {
    if (shouldSuppressDragClick()) return;
    setSftpPanelOpen(false);
    setSplitTabActive(false);
    setActive(sessionId);
    setActiveNav("terminal" as any);
  };

  const closeSessionById = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    const mpConn = useTeamSessionStore.getState().connections[sessionId];
    if (mpConn) {
      if (mpConn.role === "host") {
        useTeamSessionStore.getState().stopSharing(sessionId).catch(() => {});
      } else {
        leaveMultiplayerSession(sessionId);
      }
    }
    if (session?.type === ("multiplayer" as any)) {
      removeSession(sessionId);
    } else if (session?.status === "connected" || session?.status === "connecting") {
      disconnect(sessionId);
    } else {
      removeSession(sessionId);
    }
  };

  const handleTabClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    closeSessionById(sessionId);
    useLayoutStore.getState().removeSession(sessionId);
    if (sessions.length <= 1) setActiveNav("hosts");
  };

  const handleUnifiedTabClick = (tabId: string) => {
    if (shouldSuppressDragClick()) return;
    setSftpPanelOpen(false);
    activateSplitTab(tabId);
    const layout = useLayoutStore.getState();
    const leaf = findLeaf(layout.root, layout.activePaneId) ?? firstLeaf(layout.root);
    if (leaf) setActive(leaf.sessionId);
    setActiveNav("terminal" as any);
  };

  const handleUnifiedTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const tab = useLayoutStore.getState().splitTabs.find((candidate) => candidate.id === tabId);
    const ids = tab ? getPaneSessionIds(tab.root) : [];
    ids.forEach(closeSessionById);
    closeSplitTab(tabId);
    if (sessions.length <= ids.length) setActiveNav("hosts");
  };

  const handleDragRegionMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('button, a, input, [role="button"]')) {
      appWindow.startDragging();
    }
  };

  const updateTitlebarDropTarget = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = useDragStore.getState();
    if (drag.dragType !== "pane" && drag.dragType !== "tab") return;
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-titlebar-key]");
    if (!tab || !e.currentTarget.contains(tab)) {
      useDragStore.getState().setDropTarget({ type: "titlebar", targetKey: null, placement: "after" });
      return;
    }
    const rect = tab.getBoundingClientRect();
    useDragStore.getState().setDropTarget({
      type: "titlebar",
      targetKey: tab.dataset.titlebarKey ?? null,
      placement: e.clientX < rect.left + rect.width / 2 ? "before" : "after",
    });
  };

  const renderTitlebarDropCue = (itemKey: string | null, placement: "before" | "after") => {
    if (dropTarget?.type !== "titlebar" || dropTarget.targetKey !== itemKey || (dropTarget.placement ?? "after") !== placement) return null;
    if (titlebarDropActive && draggedSession) return <DetachedPanePreview key={`preview-${itemKey ?? "end"}-${placement}`} session={draggedSession} />;
    if (!isDraggingTitlebarItem) return null;
    return <div key={`marker-${itemKey ?? "end"}-${placement}`} className="h-7 w-0.5 rounded-full shrink-0 bg-[var(--t-accent)]" />;
  };

  return (
    <div
      onMouseDown={handleDragRegionMouseDown}
      className="flex items-center h-[4.133rem] shrink-0 select-none bg-[var(--t-bg-terminal)]"
    >
      {/* Tabs row */}
      <div
        className="flex items-center flex-1 h-full gap-1.5 px-1 min-w-0"
      >
        {/* Vaults button */}
        <button
          onClick={() => {
            setSftpPanelOpen(false);
            setActiveNav("hosts");
          }}
          className="flex items-center gap-2.5 h-9 shrink-0 transition-all"
          style={{
            marginLeft: "0.75rem",
            background: isVaultsActive ? "var(--t-vault-tab-active-bg)" : "var(--t-vault-tab-bg)",
            color: isVaultsActive ? "var(--t-text-primary)" : "var(--t-text-secondary)",
            borderRadius: "0.667rem",
            padding: isVaultCompact ? "0 0.667rem" : "0 1.067rem",
          }}
          onMouseEnter={(e) => {
            if (!isVaultsActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--t-vault-tab-active-bg)";
          }}
          onMouseLeave={(e) => {
            if (!isVaultsActive) {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-vault-tab-bg)";
            }
          }}
        >
          <Icon icon="lucide:vault" width={20} />
          {!isVaultCompact && <span>Vaults</span>}
        </button>

        {/* SFTP button */}
        <button
          onClick={() => {
            const nextOpen = !sftpPanelOpen;
            if (nextOpen) setRightPanelOpen(false);
            setSftpPanelOpen(nextOpen);
          }}
          className="flex items-center gap-2.5 h-9 shrink-0 transition-all"
          style={{
            background: sftpPanelOpen ? "var(--t-vault-tab-active-bg)" : "var(--t-vault-tab-bg)",
            color: sftpPanelOpen ? "var(--t-text-primary)" : "var(--t-text-secondary)",
            borderRadius: "0.667rem",
            padding: isSftpCompact ? "0 0.667rem" : "0 1.067rem",
          }}
          title="File Transfer (SFTP)"
          onMouseEnter={(e) => {
            if (!sftpPanelOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-vault-tab-active-bg)";
            }
          }}
          onMouseLeave={(e) => {
            if (!sftpPanelOpen) {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-vault-tab-bg)";
            }
          }}
        >
          <Icon icon="lucide:folder-closed" width={20} />
          {!isSftpCompact && <span>SFTP</span>}
        </button>

        {/* Separator */}
        {sessions.length > 0 && (
          <div className="shrink-0 w-px h-[1.667rem] bg-[var(--t-bg-card-hover)]" />
        )}

        {/* Scrollable session tabs */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto flex-1 h-full min-w-0 rounded-xl transition-colors"
          style={{
            background: titlebarDropActive
              ? "color-mix(in srgb, var(--t-accent) 10%, transparent)"
              : undefined,
          }}
          onMouseEnter={updateTitlebarDropTarget}
          onMouseMove={updateTitlebarDropTarget}
          onMouseLeave={() => {
            if (useDragStore.getState().dropTarget?.type === "titlebar") useDragStore.getState().setDropTarget(null);
          }}
        >
        {titlebarItems.map((item) => {
          if (item.type === "split") {
            const tab = item.tab;
            const tabSessionIds = getPaneSessionIds(tab.root);
            const tabActiveLeaf = findLeaf(tab.root, tab.activePaneId) ?? firstLeaf(tab.root);
            const tabActiveSession = tabActiveLeaf ? sessions.find((session) => session.id === tabActiveLeaf.sessionId) : null;
            const isActiveSplitTab = splitTabActive && activeSplitTabId === tab.id && activeNav === ("terminal" as any) && !sftpPanelOpen;

            return (
              <div key={item.key} className="contents">
                {renderTitlebarDropCue(item.key, "before")}
                <button
                  data-titlebar-key={item.key}
                  onClick={() => handleUnifiedTabClick(tab.id)}
                  onMouseDown={(e) => {
                    if (e.button === 0) useDragStore.getState().beginSplitTabDrag(tab.id, e.clientX, e.clientY);
                  }}
                  className="group relative flex items-center gap-2 h-9 px-2 rounded-xl text-base font-medium-bold shrink-0 transition-all"
                  title="Unified split tab"
                  style={{
                    background: isActiveSplitTab ? "var(--t-tab-active-bg)" : "var(--t-tab-bg)",
                    color: isActiveSplitTab ? "var(--t-tab-active-text)" : "var(--t-text-secondary)",
                    border: isActiveSplitTab ? "1px solid var(--t-tab-active-border)" : "1px solid transparent",
                  }}
                >
                  <Icon icon="lucide:panel-top-open" width={18} />
                  <span className="max-w-[140px] truncate">
                    {tabActiveSession?.connectionName ?? "Split"}{tabSessionIds.length > 1 ? ` + ${tabSessionIds.length - 1}` : ""}
                  </span>
                  <span
                    onClick={(e) => handleUnifiedTabClose(e, tab.id)}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5"
                    style={{ color: isActiveSplitTab ? "var(--t-tab-active-text)" : "var(--t-text-muted)" }}
                  >
                    <span className="[&_path]:[stroke-width:2.1]"><Icon icon="lucide:x" width={20} /></span>
                  </span>
                </button>
                {renderTitlebarDropCue(item.key, "after")}
              </div>
            );
          }

          const session = item.session;
          const isActive = session.id === activeSessionId && activeNav === ("terminal" as any) && !sftpPanelOpen && !splitTabActive;
          const statusColor =
            session.status === "connected"  ? "var(--t-status-connected)" :
            session.status === "error"      ? "var(--t-status-error)" :
            session.status === "connecting" ? "var(--t-status-connecting)" :
                                              "var(--t-text-muted)";
          const connection = connections.find((c) => c.id === session.connectionId);
          const isLocal = session.type === "local";
          const distroIcon = !isActive && !isLocal && connection?.distro ? getDistroIcon(connection.distro) : null;
          const distroBg = distroIcon && connection?.distro ? getDistroColor(connection.distro) : null;

          return (
            <div key={item.key} className="contents">
              {renderTitlebarDropCue(item.key, "before")}
              <button
                data-titlebar-key={item.key}
                onClick={() => handleTabClick(session.id)}
                onMouseDown={(e) => {
                  if (e.button === 0) useDragStore.getState().beginTabDrag(session.id, e.clientX, e.clientY, item.key);
                }}
                onAuxClick={(e) => { if (e.button === 1) handleTabClose(e, session.id); }}
                className="group relative flex items-center gap-2 h-9 px-2 rounded-xl text-base font-medium-bold shrink-0 transition-all"
                style={{
                  background: isActive ? "var(--t-tab-active-bg)" : "var(--t-tab-bg)",
                  color: isActive ? "var(--t-tab-active-text)" : "var(--t-text-secondary)",
                  border: isActive ? "1px solid var(--t-tab-active-border)" : "1px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-sidebar)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--t-tab-bg)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
                  }
                }}
              >
                {distroIcon ? (
                  <span
                    className="flex items-center justify-center size-6 rounded-md shrink-0"
                    style={{ background: distroBg ?? "transparent", color: "#fff" }}
                  >
                    <Icon icon={distroIcon} width={16} />
                  </span>
                ) : isLocal ? (
                  <span
                    className="flex items-center justify-center size-6 rounded-md shrink-0"
                    style={{ color: isActive ? "var(--t-tab-active-text)" : statusColor }}
                  >
                    <Icon icon="lucide:terminal" width={14} />
                  </span>
                ) : (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: isActive ? "var(--t-tab-active-text)" : statusColor,
                      opacity: isActive ? 0.8 : 1,
                    }}
                  />
                )}
                <span className="max-w-[140px] truncate">{session.connectionName}</span>
                <span
                  onClick={(e) => handleTabClose(e, session.id)}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5"
                  style={{ color: isActive ? "var(--t-tab-active-text)" : "var(--t-text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  <span className="[&_path]:[stroke-width:2.1]">
                  <Icon icon="lucide:x" width={20} />
                  </span>
                </span>
              </button>
              {renderTitlebarDropCue(item.key, "after")}
            </div>
          );
        })}

        {renderTitlebarDropCue(null, "after")}

        {/* New tab button */}
        <NewTabButton
          onNavigate={() => {
            setSftpPanelOpen(false);
            setActiveNav("hosts");
          }}
        />
        </div>
      </div>

      {accountMode === "server" && <SubscriptionBadge />}

      {/* Sync indicator */}
      <SyncIndicator
        anchorRef={syncButtonRef}
        status={effectiveSyncStatus}
        lastSync={effectiveLastSync}
        error={effectiveError}
        active={syncDropdownOpen}
        configured={effectiveConfigured}
        onClick={() => setSyncDropdownOpen((o) => !o)}
      />
      <SyncDropdown
        anchorRef={syncButtonRef}
        open={syncDropdownOpen}
        onClose={() => setSyncDropdownOpen(false)}
        cloudActive={syncState.cloudActive}
        gistPluginEnabled={gistPluginEnabled}
        accountMode={accountMode}
      />

      {/* Update indicator */}
      {(updaterState.status === "checking" || updaterState.status === "downloading" || updaterState.status === "ready") && (
        <UpdateIndicator state={updaterState} />
      )}

      {/* Watching / Ended badge — guest in a multiplayer session */}
      {showTerminal && isActiveSessionMultiplayer && (
        <div className="flex items-center px-1 shrink-0">
          {isActiveSessionEnded ? (
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
              style={{
                background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
                color: "var(--t-status-error)",
                border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--t-status-error)" }} />
              Ended
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
              style={{
                background: "color-mix(in srgb, var(--t-accent) 12%, transparent)",
                color: "var(--t-accent)",
                border: "1px solid color-mix(in srgb, var(--t-accent) 25%, transparent)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--t-accent)" }} />
              Watching
            </span>
          )}
        </div>
      )}

      {/* Share button — only in terminal view for non-multiplayer sessions */}
      {showTerminal && !isActiveSessionMultiplayer && (
        <div className="flex items-center px-1 shrink-0">
          <button
            ref={shareButtonRef}
            onClick={() => setShareDropdownOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all"
            style={{
              background: isActiveSessionSharing
                ? "color-mix(in srgb, var(--t-accent) 15%, transparent)"
                : shareDropdownOpen ? "var(--t-bg-elevated)" : "transparent",
              color: isActiveSessionSharing ? "var(--t-accent)" : "var(--t-text-secondary)",
              border: isActiveSessionSharing
                ? "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)"
                : "1px solid transparent",
            }}
            title={
              isActiveSessionSharing        ? "Currently sharing" :
              accountMode !== "server"      ? "Sign in to share your terminal" :
              tier === "free"               ? "Terminal sharing requires Pro — click to upgrade" :
                                              "Share terminal"
            }
            onMouseEnter={(e) => {
              if (!isActiveSessionSharing && !shareDropdownOpen) {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActiveSessionSharing && !shareDropdownOpen) {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }
            }}
          >
            <Icon icon="lucide:radio" width={13} />
            {isActiveSessionSharing ? "Sharing" : "Share"}
          </button>
          {activeSessionId && (
            <ShareMenu
              anchorRef={shareButtonRef}
              open={shareDropdownOpen}
              onClose={() => setShareDropdownOpen(false)}
              activeSessionId={activeSessionId}
              connectionName={activeSession?.connectionName ?? "Terminal"}
              isLoggedIn={accountMode === "server"}
              tier={tier}
              onSignIn={() => { setShareDropdownOpen(false); openSettings("account"); }}
              onUpgrade={() => { setShareDropdownOpen(false); openSettings("account"); }}
            />
          )}
        </div>
      )}

      {/* Right panel toggle — only in terminal view */}
      {showTerminal && (
        <div className="flex items-center px-2 shrink-0">
          <button
            onClick={() => toggleRightPanel("themes")}
            className="p-1.5 rounded-md transition-all"
            style={{
              background: rightPanelOpen ? "var(--t-tab-active-bg)" : "transparent",
              color: rightPanelOpen ? "var(--t-tab-active-text)" : "var(--t-text-secondary)",
              border: rightPanelOpen ? "1px solid var(--t-tab-active-border)" : "1px solid transparent",
            }}
            title={`Themes & tools · ${activeThemeName}`}
            onMouseEnter={(e) => { if (!rightPanelOpen) { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)"; (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)"; } }}
            onMouseLeave={(e) => { if (!rightPanelOpen) { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; } }}
          >
            <Icon icon="lucide:panel-right" width={16} />
          </button>
        </div>
      )}

      <NotificationBell />

      {/* Window controls */}
      <div className="flex items-center gap-0.5 px-2 shrink-0">
        <TitleBarBtn onClick={() => appWindow.minimize()} title="Minimize">
          <Icon icon="lucide:minus" width={20} />
        </TitleBarBtn>
        <TitleBarBtn onClick={() => appWindow.toggleMaximize()} title="Maximize">
          <Icon icon="lucide:square" width={15} />
        </TitleBarBtn>
        <TitleBarBtn onClick={() => appWindow.close()} title="Close">
          <Icon icon="lucide:x" width={20} />
        </TitleBarBtn>
      </div>
    </div>
  );
}

function NewTabButton({ onNavigate }: { onNavigate: () => void }) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onNavigate}
      onMouseDown={createRipple}
      className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-colors text-[var(--t-text-dim)] relative overflow-hidden"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-tab-active-text)";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-sidebar)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
      title="New session"
    >
      {rippleEls}
      <Icon icon="lucide:plus" width={22} />
    </button>
  );
}

function DetachedPanePreview({ session }: { session: ReturnType<typeof useSessionStore.getState>["sessions"][number] }) {
  const connections = useConnectionStore((s) => s.connections);
  const connection = connections.find((c) => c.id === session.connectionId);
  const isLocal = session.type === "local";
  const distroIcon = !isLocal && connection?.distro ? getDistroIcon(connection.distro) : null;
  const distroBg = distroIcon && connection?.distro ? getDistroColor(connection.distro) : null;
  const statusColor =
    session.status === "connected"  ? "var(--t-status-connected)" :
    session.status === "error"      ? "var(--t-status-error)" :
    session.status === "connecting" ? "var(--t-status-connecting)" :
                                      "var(--t-text-muted)";

  return (
    <div
      className="pointer-events-none flex items-center gap-2 h-9 px-2 rounded-xl text-base font-medium-bold shrink-0 transition-all"
      style={{
        background: "var(--t-tab-active-bg)",
        color: "var(--t-tab-active-text)",
        border: "1px solid var(--t-tab-active-border)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--t-accent) 35%, transparent)",
      }}
    >
      {distroIcon ? (
        <span
          className="flex items-center justify-center size-6 rounded-md shrink-0"
          style={{ background: distroBg ?? "transparent", color: "#fff" }}
        >
          <Icon icon={distroIcon} width={16} />
        </span>
      ) : isLocal ? (
        <span
          className="flex items-center justify-center size-6 rounded-md shrink-0"
          style={{ color: "var(--t-tab-active-text)" }}
        >
          <Icon icon="lucide:terminal" width={14} />
        </span>
      ) : (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
      )}
      <span className="max-w-[140px] truncate">{session.connectionName}</span>
    </div>
  );
}

function TitleBarBtn({ onClick, title, children }: {
  onClick: (() => void) | undefined;
  title: string;
  children: React.ReactNode;
}) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      onClick={onClick}
      onMouseDown={createRipple}
      title={title}
      className="flex items-center justify-center size-8 rounded-md transition-colors text-[var(--t-text-dim)] bg-transparent relative overflow-hidden"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {rippleEls}
      {children}
    </button>
  );
}

function UpdateIndicator({ state }: { state: UpdaterStatus }) {
  const { createRipple, rippleEls } = useRipple();

  if (state.status === "checking") {
    return (
      <div className="flex items-center px-1 shrink-0">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-xl text-[var(--t-text-dim)] cursor-default"
          title="Checking for updates…"
        >
          <Icon icon="lucide:refresh-cw" width={15} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (state.status === "downloading") {
    const pct = state.progress;
    const label = pct > 0 ? `Downloading update v${state.version} — ${pct}%` : `Downloading update v${state.version}…`;
    return (
      <div className="flex items-center px-1 shrink-0">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-xl text-[var(--t-text-primary)] cursor-default"
          title={label}
        >
          <Icon icon="lucide:download" width={18} className="animate-bounce" />
        </div>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div className="flex items-center px-1 shrink-0">
        <button
          onClick={() => installUpdate().catch(() => {})}
          onMouseDown={createRipple}
          title={`v${state.version} downloaded — click to restart and update`}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-xl transition-all bg-[var(--t-accent)] text-white text-[0.8rem] font-semibold relative overflow-hidden"
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          {rippleEls}
          <Icon icon="lucide:refresh-cw" width={14} />
          <span>Update ready · Restart</span>
        </button>
      </div>
    );
  }

  return null;
}

function SubscriptionBadge() {
  const openSettings = useUIStore((s) => s.openSettings);
  const { tier, trialEndsAt, trialUsed, isTrialActive } = useSubscriptionStore();
  const [hovered, setHovered] = useState(false);

  const isPremium = tier !== "free";

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : 0;

  const hoverLabel = isTrialActive
    ? `Pro Trial — ${daysLeft}d left`
    : tier === "teams" ? "Teams"
    : tier === "business" ? "Business"
    : tier === "pro" ? "Pro"
    : trialUsed ? "Upgrade"
    : "Upgrade · 14d Free Trial";

  return (
    <div className="flex items-center px-1 shrink-0">
      <button
        onClick={() => openSettings("account")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center gap-1.5 h-7 rounded-lg overflow-hidden transition-all"
        style={{
          maxWidth: hovered ? "10rem" : "2rem",
          padding: hovered ? "0 0.5rem" : "0 0.375rem",
          whiteSpace: "nowrap",
          transition: "max-width 250ms ease, padding 250ms ease, color 150ms ease",
          color: hovered
            ? isPremium ? "#f59e0b" : "var(--t-accent)"
            : isPremium ? "#f59e0b" : "var(--t-text-secondary)",
          background: hovered ? "var(--t-bg-elevated)" : "transparent",
        }}
        title={hoverLabel}
      >
        <Icon
          icon={isPremium ? "lucide:crown" : "lucide:circle-fading-arrow-up"}
          width={14}
          className="shrink-0"
        />
        <span className="text-xs font-medium overflow-hidden" style={{ opacity: hovered ? 1 : 0, transition: "opacity 150ms ease" }}>
          {hoverLabel}
        </span>
      </button>
    </div>
  );
}

function SyncIndicator({
  anchorRef,
  status,
  lastSync,
  error,
  active,
  configured,
  onClick,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
  active: boolean;
  configured: boolean;
  onClick: () => void;
}) {
  const { createRipple, rippleEls } = useRipple();
  const icon = !configured ? "lucide:cloud-off" :
    status === "syncing" ? "lucide:refresh-cw" :
    status === "success" ? "lucide:cloud-check" :
    status === "error"   ? "lucide:cloud-alert" :
    status === "offline" ? "lucide:wifi-off" :
                           "lucide:cloud";

  const color = !configured ? "var(--t-text-dim)" :
    status === "syncing" ? "var(--t-text-primary)" :
    status === "success" ? "var(--t-status-connected)" :
    status === "error"   ? "var(--t-status-error)" :
    status === "offline" ? "var(--t-text-dim)" :
                           "var(--t-text-muted)";

  const title = !configured ? "Sync not configured" :
    status === "syncing" ? "Syncing…" :
    status === "success" ? `Synced${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}` :
    status === "error"   ? `Sync error: ${error ?? "unknown"}` :
    status === "offline" ? "Offline" :
                           "Sync";

  return (
    <div className="flex items-center px-1 shrink-0">
      <button
        ref={anchorRef}
        onClick={onClick}
        onMouseDown={createRipple}
        className="flex items-center justify-center w-8 h-8 rounded-xl transition-colors relative overflow-hidden cursor-pointer"
        style={{
          color: active ? "var(--t-tab-active-text)" : color,
          background: active ? "var(--t-tab-active-bg)" : "transparent",
          border: active ? "1px solid var(--t-tab-active-border)" : "1px solid transparent",
        }}
        title={title}
        onMouseEnter={(e) => {
          if (!active) {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-sidebar)";
            (e.currentTarget as HTMLButtonElement).style.color = status === "error"
              ? "var(--t-status-error)" : "var(--t-tab-active-text)";
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = color;
          }
        }}
      >
        {rippleEls}
        <Icon
          icon={icon}
          width={18}
          className={status === "syncing" ? "animate-spin" : ""}
        />
      </button>
    </div>
  );
}
