import {
  findLeafBySession,
  getPaneSessionIds,
  type LeafNode,
  type PaneNode,
  type SplitPosition,
  type SplitTab,
} from "@/stores/layoutStore";

/**
 * The layout operations this domain needs, as plain functions.
 *
 * `activateSplitTab` is layout-only: every mutating store method acts on the
 * ACTIVE split tab (`layoutStore.ts:290-369`), so a write aimed at another tab
 * has to activate it first. `focusStandaloneTab` and `revealActiveTab` are the
 * user-visible reveal, and mirror the titlebar's own click handlers
 * (`TitleBar.tsx:130` and `:162`) — without them a "focused" pane can sit
 * behind the SFTP panel or the Vaults nav and never become visible.
 */
export interface PanePorts {
  splitTabs(): SplitTab[];
  activeSplitTabId(): string | null;
  splitTabActive(): boolean;
  sessions(): { id: string; connectionName: string }[];
  activeSessionId(): string | null;
  activateSplitTab(tabId: string): void;
  createSplitTab(targetSessionId: string, incomingSessionId: string, position: SplitPosition): void;
  splitPane(targetPaneId: string, sessionId: string, position: SplitPosition): void;
  movePane(sourcePaneId: string, targetPaneId: string, position: SplitPosition): void;
  detachPane(paneId: string): string | null;
  setActivePane(paneId: string): void;
  setMaximized(paneId: string | null): void;
  focusStandaloneTab(sessionId: string): void;
  revealActiveTab(sessionId: string): void;
  isMobile(): boolean;
}

export interface ProjectedPane {
  paneId: string;
  sessionId: string;
  connectionName: string;
  active: boolean;
  maximized: boolean;
}

export interface ProjectedTab {
  tabId: string;
  kind: "split" | "session";
  active: boolean;
  panes: ProjectedPane[];
  broadcastActive: boolean;
  layout: PaneNode | null;
}

export type PaneResult =
  | { ok: true; tab: ProjectedTab | null }
  | { ok: false; error: string };

export const PANE_ERRORS = {
  mobile: "panes are not available on this platform",
  noSession: "no such open session; call list_sessions for the current ids",
  same: "sessionId and targetSessionId are the same session",
  alreadySplit: "that session is already in a split tab; use session_move_to_pane",
  notSplit: "that session is not in a split tab; use pane_split first",
  // Every layout store method returns {} rather than throwing when it cannot
  // find its target, so a write is only known to have happened by re-reading.
  unchanged: "the layout did not change as requested; call pane_list and try again",
} as const;

function leaves(root: PaneNode | null): LeafNode[] {
  if (!root) return [];
  return root.type === "leaf" ? [root] : [...leaves(root.first), ...leaves(root.second)];
}

function nameOf(ports: PanePorts, sessionId: string): string {
  return ports.sessions().find((s) => s.id === sessionId)?.connectionName ?? "";
}

export function projectSplitTab(ports: PanePorts, tab: SplitTab): ProjectedTab {
  return {
    tabId: tab.id,
    kind: "split",
    active: ports.splitTabActive() && ports.activeSplitTabId() === tab.id,
    panes: leaves(tab.root).map((leaf) => ({
      paneId: leaf.id,
      sessionId: leaf.sessionId,
      connectionName: nameOf(ports, leaf.sessionId),
      active: tab.activePaneId === leaf.id,
      maximized: tab.maximizedPaneId === leaf.id,
    })),
    broadcastActive: tab.broadcastActive,
    layout: tab.root,
  };
}

export function projectSessionTab(ports: PanePorts, session: { id: string; connectionName: string }): ProjectedTab {
  return {
    tabId: `session:${session.id}`,
    kind: "session",
    active: !ports.splitTabActive() && ports.activeSessionId() === session.id,
    panes: [{
      paneId: `session:${session.id}`,
      sessionId: session.id,
      connectionName: session.connectionName,
      active: true,
      maximized: false,
    }],
    broadcastActive: false,
    layout: null,
  };
}

/** Every titlebar item: split tabs first, then the sessions no split tab holds
 *  — the same partition the titlebar itself renders (`TitleBar.tsx:105-108`). */
export function listTabs(ports: PanePorts): ProjectedTab[] {
  const held = new Set(ports.splitTabs().flatMap((tab) => getPaneSessionIds(tab.root)));
  return [
    ...ports.splitTabs().map((tab) => projectSplitTab(ports, tab)),
    ...ports.sessions().filter((s) => !held.has(s.id)).map((s) => projectSessionTab(ports, s)),
  ];
}

export function locate(ports: PanePorts, sessionId: string): { tab: SplitTab; leaf: LeafNode } | null {
  for (const tab of ports.splitTabs()) {
    const leaf = findLeafBySession(tab.root, sessionId);
    if (leaf) return { tab, leaf };
  }
  return null;
}

interface PairInput {
  sessionId: string;
  targetSessionId: string;
  position: SplitPosition;
}

function exists(ports: PanePorts, sessionId: string): boolean {
  return ports.sessions().some((s) => s.id === sessionId);
}

/** The checks both pair verbs share; null when the call may proceed. */
function preflight(ports: PanePorts, input: PairInput): PaneResult | null {
  if (ports.isMobile()) return { ok: false, error: PANE_ERRORS.mobile };
  if (input.sessionId === input.targetSessionId) return { ok: false, error: PANE_ERRORS.same };
  if (!exists(ports, input.sessionId) || !exists(ports, input.targetSessionId)) {
    return { ok: false, error: PANE_ERRORS.noSession };
  }
  return null;
}

/** Place a session beside a target, hiding the store's two entry points: a
 *  standalone target needs a new split tab, one already in a tab needs a split
 *  of its own pane. */
function attach(ports: PanePorts, input: PairInput): void {
  const target = locate(ports, input.targetSessionId);
  if (target) {
    ports.activateSplitTab(target.tab.id);
    ports.splitPane(target.leaf.id, input.sessionId, input.position);
  } else {
    ports.createSplitTab(input.targetSessionId, input.sessionId, input.position);
  }
}

/** Re-read the layout and confirm both sessions ended up in one tab. */
function verifyTogether(ports: PanePorts, input: PairInput): PaneResult {
  const placed = locate(ports, input.sessionId);
  if (!placed || !findLeafBySession(placed.tab.root, input.targetSessionId)) {
    return { ok: false, error: PANE_ERRORS.unchanged };
  }
  return { ok: true, tab: projectSplitTab(ports, placed.tab) };
}

export function splitWith(ports: PanePorts, input: PairInput): PaneResult {
  const refused = preflight(ports, input);
  if (refused) return refused;
  // The store would silently just focus an already-split session
  // (`layoutStore.ts:297`), which would report success for a no-op.
  if (locate(ports, input.sessionId)) return { ok: false, error: PANE_ERRORS.alreadySplit };
  attach(ports, input);
  return verifyTogether(ports, input);
}

export function moveToPane(ports: PanePorts, input: PairInput): PaneResult {
  const refused = preflight(ports, input);
  if (refused) return refused;
  const source = locate(ports, input.sessionId);
  if (!source) return { ok: false, error: PANE_ERRORS.notSplit };

  const target = locate(ports, input.targetSessionId);
  if (target && target.tab.id === source.tab.id) {
    ports.activateSplitTab(source.tab.id);
    ports.movePane(source.leaf.id, target.leaf.id, input.position);
  } else {
    ports.activateSplitTab(source.tab.id);
    ports.detachPane(source.leaf.id);
    attach(ports, input);
  }
  return verifyTogether(ports, input);
}
