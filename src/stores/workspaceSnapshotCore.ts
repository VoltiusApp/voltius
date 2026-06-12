// Pure logic for the workspace snapshot: building it from store state and
// validating it back at launch. No zustand/tauri/"@/" imports so it runs
// under plain node (`node --experimental-strip-types`), matching the
// reconnectBackoffCore testing pattern. Types here are structural mirrors
// of the app types (TerminalSession, SerialConnectParams, SplitTab) —
// the stores adapt at the boundary.

export const SNAPSHOT_VERSION = 1;

/** Structural mirror of SerialConnectParams (src/types). */
export interface SnapshotSerialConfig {
  sessionId: string;
  port: string;
  baud: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
  flowControl?: string;
}

export interface SnapshotSession {
  /** ORIGINAL session UUID — the tmux key voltius_<id> derives from it. */
  id: string;
  type: "ssh" | "local" | "serial";
  connectionId: string;
  connectionName: string;
  /** Whether persistence (tmux/screen) was active when it connected. */
  persist: boolean;
  cwd?: string;
  localShell?: string;
  serialConfig?: SnapshotSerialConfig;
  encoding?: string;
  /** Lines the viewport was scrolled up from the live prompt (baseY - viewportY)
   * when snapshotted. Omitted when 0 (at bottom). Re-applied best-effort after
   * history replay; the rebuilt buffer wraps differently so it's approximate. */
  scrollLinesFromBottom?: number;
}

/** Opaque layout payload. splitTabs holds layoutStore SplitTab objects;
 * the core only checks shape, layoutStore.hydrate() consumes them. */
export interface SnapshotLayout {
  splitTabs: unknown[];
  activeSplitTabId: string | null;
  splitTabActive: boolean;
  titlebarOrder: string[];
}

export interface WorkspaceSnapshot {
  version: number;
  savedAt: string;
  activeSessionId: string | null;
  layout: SnapshotLayout;
  sessions: SnapshotSession[];
}

/** Structural superset of TerminalSession accepted as build input. */
export interface SessionInput {
  id: string;
  type: string;
  connectionId: string;
  connectionName: string;
  persist?: boolean;
  encoding?: string;
  localShell?: string;
  serialConfig?: SnapshotSerialConfig;
  containerExec?: unknown;
}

/** A session can be restored when it's a plain ssh/local/serial tab.
 * Multiplayer views, docker/lxc exec tabs (their parent session id would be
 * stale), and ephemeral serial tabs that never got a config are skipped. */
export function isSnapshotable(s: SessionInput): boolean {
  if (s.type !== "ssh" && s.type !== "local" && s.type !== "serial") return false;
  if (s.containerExec) return false;
  if (s.type === "serial" && !s.serialConfig) return false;
  return true;
}

export function buildSnapshot(input: {
  sessions: SessionInput[];
  cwds: Record<string, string>;
  scrollOffsets?: Record<string, number>;
  layout: SnapshotLayout;
  activeSessionId: string | null;
  now?: Date;
}): WorkspaceSnapshot {
  const sessions = input.sessions.filter(isSnapshotable).map((s): SnapshotSession => {
    const offset = input.scrollOffsets?.[s.id] ?? 0;
    return {
      id: s.id,
      type: s.type as SnapshotSession["type"],
      connectionId: s.connectionId,
      connectionName: s.connectionName,
      persist: s.persist ?? false,
      cwd: input.cwds[s.id],
      localShell: s.localShell,
      serialConfig: s.serialConfig,
      encoding: s.encoding,
      ...(offset > 0 ? { scrollLinesFromBottom: offset } : {}),
    };
  });
  const ids = new Set(sessions.map((s) => s.id));
  return {
    version: SNAPSHOT_VERSION,
    savedAt: (input.now ?? new Date()).toISOString(),
    activeSessionId:
      input.activeSessionId && ids.has(input.activeSessionId) ? input.activeSessionId : null,
    layout: {
      ...input.layout,
      splitTabs: [...input.layout.splitTabs],
      titlebarOrder: [...input.layout.titlebarOrder],
    },
    sessions,
  };
}

function isValidSession(x: unknown): x is SnapshotSession {
  if (!x || typeof x !== "object") return false;
  const s = x as SnapshotSession;
  return (
    typeof s.id === "string" &&
    typeof s.connectionId === "string" &&
    typeof s.connectionName === "string" &&
    (s.type === "ssh" || s.type === "local" || s.type === "serial")
  );
}

/** Validate a raw (rehydrated) snapshot. Returns null when the whole
 * snapshot must be discarded (unknown version, malformed structure);
 * silently drops individual malformed session entries. */
export function parseSnapshot(raw: unknown): WorkspaceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<WorkspaceSnapshot>;
  if (s.version !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(s.sessions)) return null;
  const layout = s.layout as SnapshotLayout | undefined;
  if (
    !layout ||
    typeof layout !== "object" ||
    !Array.isArray(layout.splitTabs) ||
    !Array.isArray(layout.titlebarOrder)
  ) {
    return null;
  }
  return {
    version: SNAPSHOT_VERSION,
    savedAt: typeof s.savedAt === "string" ? s.savedAt : "",
    activeSessionId: typeof s.activeSessionId === "string" ? s.activeSessionId : null,
    layout: {
      splitTabs: layout.splitTabs,
      activeSplitTabId: typeof layout.activeSplitTabId === "string" ? layout.activeSplitTabId : null,
      splitTabActive: layout.splitTabActive === true,
      titlebarOrder: layout.titlebarOrder.filter((k): k is string => typeof k === "string"),
    },
    sessions: s.sessions.filter(isValidSession).map((x) => ({
      ...x,
      persist: x.persist === true,
      scrollLinesFromBottom:
        typeof x.scrollLinesFromBottom === "number" && x.scrollLinesFromBottom > 0
          ? Math.floor(x.scrollLinesFromBottom)
          : undefined,
    })),
  };
}
