import {
  findLeafBySession,
  getPaneSessionIds,
  splitGeometry,
  type LeafNode,
  type PaneNode,
  type SplitNode,
  type SplitPosition,
  type SplitTab,
} from "@/stores/layoutStore";
import { normalizeTabTitle } from "@/utils/sessionLabel";
import type { PluginPane, PluginPaneResult, PluginPaneTab } from "../api";

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
  sessions(): PaneSession[];
  activeSessionId(): string | null;
  activateSplitTab(tabId: string): void;
  createSplitTab(targetSessionId: string, incomingSessionId: string, position: SplitPosition): void;
  splitPane(targetPaneId: string, sessionId: string, position: SplitPosition): void;
  movePane(sourcePaneId: string, targetPaneId: string, position: SplitPosition): void;
  detachPane(paneId: string): string | null;
  setActivePane(paneId: string): void;
  setMaximized(paneId: string | null): void;
  toggleBroadcast(): void;
  focusStandaloneTab(sessionId: string): void;
  revealActiveTab(sessionId: string): void;
  /** The store setters behind the UI's own rename fields; both normalize, and a blank name clears. */
  renameSession(sessionId: string, title: string | null): void;
  renameSplitTab(tabId: string, name: string | null): void;
  isMobile(): boolean;
}

/** `title` is the user-given name (`sessionStore.renameSession`); unset, the label is the connection name. */
export interface PaneSession {
  id: string;
  connectionName: string;
  title?: string;
}

export type PaneResult = PluginPaneResult;

export const PANE_ERRORS = {
  mobile: "panes are not available on this platform",
  noSession: "no such open session; call list_sessions for the current ids",
  same: "sessionId and targetSessionId are the same session",
  alreadySplit: "that session is already in a split tab; use session_move_to_pane",
  notSplit: "that session is not in a split tab; use pane_split first",
  broadcastActive: "the target tab has broadcast typing enabled; turn broadcast off before placing a pane there",
  broadcastActiveSameTab: "that tab has broadcast typing enabled; turn broadcast off before moving panes inside it",
  noPaneToMaximize: "that session is not in a split tab; there is no pane to maximize",
  noTab: "no such split tab; call pane_list for the current tab ids",
  sessionTab: "that tab holds a single session and its label is that session's name; use pane_rename on the session",
  // Every layout store method returns {} rather than throwing when it cannot
  // find its target, so a write is only known to have happened by re-reading.
  unchanged: "the layout did not change as requested; call pane_list and try again",
  // detachPane + attach has no rollback; by the time verify runs here the
  // source has already left its original tab, so "unchanged" would be a lie.
  crossTabMovePartial: "the move was partially applied: the session left its original tab; call pane_list to see where it landed",
} as const;

function leaves(root: PaneNode | null): LeafNode[] {
  if (!root) return [];
  return root.type === "leaf" ? [root] : [...leaves(root.first), ...leaves(root.second)];
}

/** A standalone session's tab and pane id: the titlebar has no tab object for it. */
const SESSION_TAB_PREFIX = "session:";

function sessionOf(ports: PanePorts, sessionId: string): PaneSession | undefined {
  return ports.sessions().find((s) => s.id === sessionId);
}

function projectSplitTab(ports: PanePorts, tab: SplitTab): PluginPaneTab {
  return {
    tabId: tab.id,
    kind: "split",
    title: tab.name ?? null,
    active: ports.splitTabActive() && ports.activeSplitTabId() === tab.id,
    panes: leaves(tab.root).map((leaf): PluginPane => {
      const session = sessionOf(ports, leaf.sessionId);
      return {
        paneId: leaf.id,
        sessionId: leaf.sessionId,
        connectionName: session?.connectionName ?? "",
        title: session?.title ?? null,
        active: tab.activePaneId === leaf.id,
        maximized: tab.maximizedPaneId === leaf.id,
      };
    }),
    broadcastActive: tab.broadcastActive,
    layout: tab.root,
  };
}

function projectSessionTab(ports: PanePorts, session: PaneSession): PluginPaneTab {
  const active = !ports.splitTabActive() && ports.activeSessionId() === session.id;
  const title = session.title ?? null;
  return {
    tabId: `${SESSION_TAB_PREFIX}${session.id}`,
    kind: "session",
    title,
    active,
    panes: [{
      paneId: `${SESSION_TAB_PREFIX}${session.id}`,
      sessionId: session.id,
      connectionName: session.connectionName,
      title,
      active,
      maximized: false,
    }],
    broadcastActive: false,
    layout: null,
  };
}

/** Every titlebar item: split tabs first, then the sessions no split tab holds
 *  — the same partition the titlebar itself renders (`TitleBar.tsx:105-108`). */
export function listTabs(ports: PanePorts): PluginPaneTab[] {
  const held = new Set(ports.splitTabs().flatMap((tab) => getPaneSessionIds(tab.root)));
  return [
    ...ports.splitTabs().map((tab) => projectSplitTab(ports, tab)),
    ...ports.sessions().filter((s) => !held.has(s.id)).map((s) => projectSessionTab(ports, s)),
  ];
}

function locate(ports: PanePorts, sessionId: string): { tab: SplitTab; leaf: LeafNode } | null {
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

/** `useTerminal.ts` `routeInputBytes` fans every keystroke typed in the active
 *  tab out to every session it holds whenever the tab broadcasts — the only
 *  membership test is presence in the tab. Placing an owned pane into a
 *  broadcasting tab would hand the user's keystrokes, passwords included, to
 *  the agent's PTY. */
function refuseBroadcastingTarget(tab: SplitTab | null, error: string = PANE_ERRORS.broadcastActive): PaneResult | null {
  return tab?.broadcastActive ? { ok: false, error } : null;
}

/** `createSplitTab` (`layoutStore.ts:285`) inherits `state.broadcastActive`
 *  from whichever tab was active before the new one existed, so a brand-new
 *  tab can come up broadcasting by accident. Clear it rather than leaving the
 *  fresh tab silently broadcast-on. */
function clearInheritedBroadcast(ports: PanePorts): void {
  const tabId = ports.activeSplitTabId();
  const tab = ports.splitTabs().find((t) => t.id === tabId);
  if (tab?.broadcastActive) ports.toggleBroadcast();
}

/** Place a session beside a target, hiding the store's two entry points: a
 *  standalone target needs a new split tab, one already in a tab needs a split
 *  of its own pane. Callers must have already refused a broadcasting target. */
function attach(ports: PanePorts, input: PairInput): void {
  const target = locate(ports, input.targetSessionId);
  if (target) {
    ports.activateSplitTab(target.tab.id);
    ports.splitPane(target.leaf.id, input.sessionId, input.position);
  } else {
    ports.createSplitTab(input.targetSessionId, input.sessionId, input.position);
    clearInheritedBroadcast(ports);
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

/** The split-tree parent of `leafId`, or null if it is the whole tree (or absent). */
function findParentSplit(root: PaneNode, leafId: string): SplitNode | null {
  if (root.type === "leaf") return null;
  const isChild = (node: PaneNode) => node.type === "leaf" && node.id === leafId;
  if (isChild(root.first) || isChild(root.second)) return root;
  return findParentSplit(root.first, leafId) ?? findParentSplit(root.second, leafId);
}

/**
 * Re-read the layout and confirm the postcondition a same-tab move implies:
 * the two leaves are siblings under one split node, with the direction and
 * first/second order `position` implies (`splitGeometry`, `layoutStore.ts`).
 * Checking only "both sessions share a tab" (`verifyTogether`) proves nothing
 * here — that is already true before the move runs, so a silent store no-op
 * would still read as success.
 */
function verifySameTabMove(ports: PanePorts, input: PairInput): PaneResult {
  const placed = locate(ports, input.sessionId);
  if (!placed) return { ok: false, error: PANE_ERRORS.unchanged };
  const parent = findParentSplit(placed.tab.root, placed.leaf.id);
  const { direction, incomingFirst } = splitGeometry(input.position);
  const [expectedFirst, expectedSecond] = incomingFirst
    ? [input.sessionId, input.targetSessionId]
    : [input.targetSessionId, input.sessionId];
  const ok = parent !== null
    && parent.direction === direction
    && parent.first.type === "leaf" && parent.first.sessionId === expectedFirst
    && parent.second.type === "leaf" && parent.second.sessionId === expectedSecond;
  if (!ok) return { ok: false, error: PANE_ERRORS.unchanged };
  return { ok: true, tab: projectSplitTab(ports, placed.tab) };
}

/** The cross-tab branch composes detach + attach with no rollback, so by the
 *  time this runs the source has already left its original tab (which the
 *  detach may itself have collapsed). No reachable failure through this path
 *  is known — every precondition it depends on (source located, target
 *  resolved, not broadcasting) is checked before either mutation — but if one
 *  turns up, "unchanged" would be a lie: the layout is not what it was. */
function verifyCrossTabMove(ports: PanePorts, input: PairInput): PaneResult {
  const result = verifyTogether(ports, input);
  return result.ok ? result : { ok: false, error: PANE_ERRORS.crossTabMovePartial };
}

export function splitWith(ports: PanePorts, input: PairInput): PaneResult {
  const refused = preflight(ports, input);
  if (refused) return refused;
  // The store would silently just focus an already-split session
  // (`layoutStore.ts:297`), which would report success for a no-op.
  if (locate(ports, input.sessionId)) return { ok: false, error: PANE_ERRORS.alreadySplit };
  const broadcastRefusal = refuseBroadcastingTarget(locate(ports, input.targetSessionId)?.tab ?? null);
  if (broadcastRefusal) return broadcastRefusal;
  attach(ports, input);
  return verifyTogether(ports, input);
}

export function moveToPane(ports: PanePorts, input: PairInput): PaneResult {
  const refused = preflight(ports, input);
  if (refused) return refused;
  const source = locate(ports, input.sessionId);
  if (!source) return { ok: false, error: PANE_ERRORS.notSplit };

  const target = locate(ports, input.targetSessionId);
  const sameTab = target !== null && target.tab.id === source.tab.id;
  const broadcastRefusal = refuseBroadcastingTarget(
    target?.tab ?? null,
    sameTab ? PANE_ERRORS.broadcastActiveSameTab : PANE_ERRORS.broadcastActive,
  );
  if (broadcastRefusal) return broadcastRefusal;

  if (sameTab && target) {
    ports.activateSplitTab(source.tab.id);
    ports.movePane(source.leaf.id, target.leaf.id, input.position);
    return verifySameTabMove(ports, input);
  }

  ports.activateSplitTab(source.tab.id);
  ports.detachPane(source.leaf.id);
  attach(ports, input);
  return verifyCrossTabMove(ports, input);
}

export function detach(ports: PanePorts, sessionId: string): PaneResult {
  if (ports.isMobile()) return { ok: false, error: PANE_ERRORS.mobile };
  if (!exists(ports, sessionId)) return { ok: false, error: PANE_ERRORS.noSession };
  const source = locate(ports, sessionId);
  if (!source) return { ok: false, error: PANE_ERRORS.notSplit };

  ports.activateSplitTab(source.tab.id);
  ports.detachPane(source.leaf.id);

  if (locate(ports, sessionId)) return { ok: false, error: PANE_ERRORS.unchanged };
  // A tab that lost its second-to-last leaf is gone; the session it held is a
  // standalone tab again, which the titlebar derives on its own.
  const survivor = ports.splitTabs().find((tab) => tab.id === source.tab.id) ?? null;
  return { ok: true, tab: survivor ? projectSplitTab(ports, survivor) : null };
}

export function focus(ports: PanePorts, sessionId: string, maximize?: boolean): PaneResult {
  if (ports.isMobile()) return { ok: false, error: PANE_ERRORS.mobile };
  const session = ports.sessions().find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: PANE_ERRORS.noSession };

  const found = locate(ports, sessionId);
  if (!found) {
    // No split tab means no pane to maximize against; without this refusal a
    // caller asking to maximize gets an unmodified "success" back.
    if (maximize === true) return { ok: false, error: PANE_ERRORS.noPaneToMaximize };
    ports.focusStandaloneTab(sessionId);
    if (ports.splitTabActive() || ports.activeSessionId() !== sessionId) {
      return { ok: false, error: PANE_ERRORS.unchanged };
    }
    return { ok: true, tab: projectSessionTab(ports, session) };
  }

  ports.activateSplitTab(found.tab.id);
  ports.setActivePane(found.leaf.id);
  if (maximize === true) ports.setMaximized(found.leaf.id);
  if (maximize === false) ports.setMaximized(null);
  ports.revealActiveTab(sessionId);

  const after = ports.splitTabs().find((tab) => tab.id === found.tab.id);
  if (!after || ports.activeSplitTabId() !== found.tab.id) {
    return { ok: false, error: PANE_ERRORS.unchanged };
  }
  if (after.activePaneId !== found.leaf.id) {
    return { ok: false, error: PANE_ERRORS.unchanged };
  }
  if (maximize === true && after.maximizedPaneId !== found.leaf.id) {
    return { ok: false, error: PANE_ERRORS.unchanged };
  }
  if (maximize === false && after.maximizedPaneId !== null) {
    return { ok: false, error: PANE_ERRORS.unchanged };
  }
  return { ok: true, tab: projectSplitTab(ports, after) };
}

/** The tab a session sits in: its split tab, else its own standalone tab. */
function projectTabOf(ports: PanePorts, session: PaneSession): PluginPaneTab {
  const found = locate(ports, session.id);
  return found ? projectSplitTab(ports, found.tab) : projectSessionTab(ports, session);
}

/**
 * Name a session: the label on its tab, its pane header, and the mobile top
 * bar. Not a layout write, so it is not refused on mobile. The name is
 * compared after normalizing because the store trims and truncates, and the
 * returned tab carries what was stored, so a caller sees a cut name.
 */
export function renamePane(ports: PanePorts, sessionId: string, title: string | null): PaneResult {
  if (!exists(ports, sessionId)) return { ok: false, error: PANE_ERRORS.noSession };
  ports.renameSession(sessionId, title);
  const after = sessionOf(ports, sessionId);
  if (!after || after.title !== normalizeTabTitle(title)) return { ok: false, error: PANE_ERRORS.unchanged };
  return { ok: true, tab: projectTabOf(ports, after) };
}

/** Name a split tab. Unnamed, its label derives from the active pane (`splitTabLabel`). */
export function renameTab(ports: PanePorts, tabId: string, title: string | null): PaneResult {
  if (ports.isMobile()) return { ok: false, error: PANE_ERRORS.mobile };
  if (tabId.startsWith(SESSION_TAB_PREFIX)) return { ok: false, error: PANE_ERRORS.sessionTab };
  if (!ports.splitTabs().some((tab) => tab.id === tabId)) return { ok: false, error: PANE_ERRORS.noTab };
  ports.renameSplitTab(tabId, title);
  const after = ports.splitTabs().find((tab) => tab.id === tabId);
  if (!after || after.name !== normalizeTabTitle(title)) return { ok: false, error: PANE_ERRORS.unchanged };
  return { ok: true, tab: projectSplitTab(ports, after) };
}
