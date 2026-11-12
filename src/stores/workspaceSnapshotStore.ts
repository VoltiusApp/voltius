import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  buildSnapshot,
  parseSnapshot,
  type SnapshotLayout,
  type WorkspaceSnapshot,
} from "./workspaceSnapshotCore";
import { useSessionStore } from "./sessionStore";
import { useLayoutStore } from "./layoutStore";
import { useTerminalCwdStore } from "./terminalCwdStore";
import { getToggle } from "./toggleSettingsStore";
import { getScrollOffset, subscribeTerminalScroll } from "@/hooks/useTerminal";
import { isTeamConnection } from "@/services/teamConnectionIds";

interface WorkspaceSnapshotState {
  snapshot: WorkspaceSnapshot | null;
  set: (snapshot: WorkspaceSnapshot | null) => void;
}

export const useWorkspaceSnapshotStore = create<WorkspaceSnapshotState>()(
  persist(
    (set) => ({
      snapshot: null,
      set: (snapshot) => set({ snapshot }),
    }),
    { name: "voltius-workspace-snapshot" },
  ),
);

/** Validated read; null when absent, version-mismatched, or malformed. */
export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  return parseSnapshot(useWorkspaceSnapshotStore.getState().snapshot);
}

export function clearWorkspaceSnapshot(): void {
  useWorkspaceSnapshotStore.getState().set(null);
}

const DEBOUNCE_MS = 500;
let started = false;

/**
 * Continuously mirror session/layout/cwd state into the persisted snapshot,
 * debounced. MUST be started only after the launch restore decision has been
 * made (see workspaceRestore.ts) — starting earlier would overwrite the
 * snapshot with the empty boot state before restore reads it.
 */
export function startWorkspaceSnapshotSync(): void {
  if (started) return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    timer = null;
    if (!getToggle("restore-workspace")) return;
    const { sessions, activeSessionId } = useSessionStore.getState();
    const l = useLayoutStore.getState();
    const layout: SnapshotLayout = {
      splitTabs: l.splitTabs,
      activeSplitTabId: l.activeSplitTabId,
      splitTabActive: l.splitTabActive,
      titlebarOrder: l.titlebarOrder,
      pinnedKeys: l.pinnedKeys,
    };
    const scrollOffsets: Record<string, number> = {};
    for (const s of sessions) {
      const offset = getScrollOffset(s.id);
      if (offset > 0) scrollOffsets[s.id] = offset;
    }
    useWorkspaceSnapshotStore.getState().set(
      buildSnapshot({
        sessions,
        cwds: useTerminalCwdStore.getState().cwds,
        scrollOffsets,
        layout,
        activeSessionId,
        isTeamConnection,
      }),
    );
  };

  const schedule = () => {
    if (timer === null) timer = setTimeout(write, DEBOUNCE_MS);
  };

  const writeNow = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    write();
  };

  // Structural changes (tab opened/closed, lock, pin) write immediately so a quit right
  // after can't race the debounce; status/cwd/layout churn stays debounced.
  const writeOnSignatureChange = (subscribe: (listener: () => void) => unknown, signature: () => string) => {
    let last = signature();
    subscribe(() => {
      const sig = signature();
      if (sig === last) return schedule();
      last = sig;
      writeNow();
    });
  };
  writeOnSignatureChange(useSessionStore.subscribe, () =>
    useSessionStore.getState().sessions.map((s) => `${s.id}${s.locked ? ":locked" : ""}`).join("\n"),
  );
  writeOnSignatureChange(useLayoutStore.subscribe, () => useLayoutStore.getState().pinnedKeys.join("\n"));
  useTerminalCwdStore.subscribe(schedule);
  // Scroll position isn't in a store; terminals notify us so the persisted
  // offset tracks the viewport (debounced, like cwd/layout churn).
  subscribeTerminalScroll(schedule);
  schedule();
}
