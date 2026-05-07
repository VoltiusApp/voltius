import { create } from "zustand";

export type SplitDirection = "h" | "v";
export type SplitPosition = "left" | "right" | "top" | "bottom";

export type PaneNode = LeafNode | SplitNode;

export interface LeafNode {
  type: "leaf";
  id: string;
  sessionId: string;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

interface LayoutStore {
  root: PaneNode | null;
  activePaneId: string | null;
  maximizedPaneId: string | null;
  broadcastActive: boolean;
  splitTabActive: boolean;

  openSplitTab(sessionId?: string): void;
  setSplitTabActive(active: boolean): void;
  createSplitTab(targetSessionId: string, incomingSessionId: string, position: SplitPosition): void;
  splitPane(targetPaneId: string, sessionId: string, position: SplitPosition): void;
  movePane(sourcePaneId: string, targetPaneId: string, position: SplitPosition): void;
  closePane(paneId: string): void;
  removeSession(sessionId: string): void;
  setRatio(splitNodeId: string, ratio: number): void;
  setActivePane(paneId: string): void;
  setMaximized(paneId: string | null): void;
  toggleBroadcast(): void;
  openSessions(sessionIds: string[]): void;
}

const clampRatio = (ratio: number) => Math.max(0.1, Math.min(0.9, ratio));

const newPaneId = () => `pane-${crypto.randomUUID()}`;
const newSplitId = () => `split-${crypto.randomUUID()}`;

export function getPaneSessionIds(root: PaneNode | null): string[] {
  if (!root) return [];
  if (root.type === "leaf") return [root.sessionId];
  return [...getPaneSessionIds(root.first), ...getPaneSessionIds(root.second)];
}

export function findLeaf(root: PaneNode | null, paneId: string | null): LeafNode | null {
  if (!root || !paneId) return null;
  if (root.type === "leaf") return root.id === paneId ? root : null;
  return findLeaf(root.first, paneId) ?? findLeaf(root.second, paneId);
}

export function findLeafBySession(root: PaneNode | null, sessionId: string): LeafNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root.sessionId === sessionId ? root : null;
  return findLeafBySession(root.first, sessionId) ?? findLeafBySession(root.second, sessionId);
}

export function firstLeaf(root: PaneNode | null): LeafNode | null {
  if (!root) return null;
  return root.type === "leaf" ? root : firstLeaf(root.first);
}

export function containsPane(root: PaneNode | null, paneId: string | null): boolean {
  if (!root || !paneId) return false;
  if (root.type === "leaf") return root.id === paneId;
  return containsPane(root.first, paneId) || containsPane(root.second, paneId);
}

function replaceLeaf(root: PaneNode, targetPaneId: string, replacement: PaneNode): PaneNode {
  if (root.type === "leaf") return root.id === targetPaneId ? replacement : root;
  return {
    ...root,
    first: replaceLeaf(root.first, targetPaneId, replacement),
    second: replaceLeaf(root.second, targetPaneId, replacement),
  };
}

function splitLeaf(target: LeafNode, leaf: LeafNode, position: SplitPosition): SplitNode {
  const direction: SplitDirection = position === "left" || position === "right" ? "h" : "v";
  const incomingFirst = position === "left" || position === "top";
  return {
    type: "split",
    id: newSplitId(),
    direction,
    ratio: 0.5,
    first: incomingFirst ? leaf : target,
    second: incomingFirst ? target : leaf,
  };
}

function buildBalancedTree(leaves: LeafNode[]): PaneNode | null {
  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0];

  const mid = Math.ceil(leaves.length / 2);
  const first = buildBalancedTree(leaves.slice(0, mid));
  const second = buildBalancedTree(leaves.slice(mid));
  if (!first || !second) return first ?? second;

  return {
    type: "split",
    id: newSplitId(),
    direction: leaves.length <= 2 ? "h" : "v",
    ratio: 0.5,
    first,
    second,
  };
}

function removeLeaf(root: PaneNode, paneId: string): { root: PaneNode | null; removed: LeafNode | null } {
  if (root.type === "leaf") {
    return root.id === paneId ? { root: null, removed: root } : { root, removed: null };
  }

  const first = removeLeaf(root.first, paneId);
  if (first.removed) {
    return { root: first.root ?? root.second, removed: first.removed };
  }

  const second = removeLeaf(root.second, paneId);
  if (second.removed) {
    return { root: second.root ?? root.first, removed: second.removed };
  }

  return { root, removed: null };
}

function removeSessionFromTree(root: PaneNode, sessionId: string): PaneNode | null {
  if (root.type === "leaf") return root.sessionId === sessionId ? null : root;
  const first = removeSessionFromTree(root.first, sessionId);
  const second = removeSessionFromTree(root.second, sessionId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return { ...root, first, second };
}

function updateRatio(root: PaneNode, splitNodeId: string, ratio: number): PaneNode {
  if (root.type === "leaf") return root;
  if (root.id === splitNodeId) return { ...root, ratio: clampRatio(ratio) };
  return {
    ...root,
    first: updateRatio(root.first, splitNodeId, ratio),
    second: updateRatio(root.second, splitNodeId, ratio),
  };
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  root: null,
  activePaneId: null,
  maximizedPaneId: null,
  broadcastActive: false,
  splitTabActive: false,

  openSplitTab: (sessionId) => {
    set((state) => {
      if (!sessionId) return { splitTabActive: true };
      const existing = findLeafBySession(state.root, sessionId);
      if (existing) {
        return { activePaneId: existing.id, splitTabActive: true };
      }
      if (!state.root) {
        const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
        return { root: leaf, activePaneId: leaf.id, splitTabActive: true };
      }
      const target = findLeaf(state.root, state.activePaneId) ?? firstLeaf(state.root);
      if (!target) return { splitTabActive: true };
      const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
      return {
        root: replaceLeaf(state.root, target.id, splitLeaf(target, leaf, "right")),
        activePaneId: leaf.id,
        splitTabActive: true,
      };
    });
  },

  setSplitTabActive: (active) => set({ splitTabActive: active }),

  createSplitTab: (targetSessionId, incomingSessionId, position) => {
    set((state) => {
      if (targetSessionId === incomingSessionId) return {};
      const target: LeafNode = { type: "leaf", id: newPaneId(), sessionId: targetSessionId };
      const incoming: LeafNode = { type: "leaf", id: newPaneId(), sessionId: incomingSessionId };
      return {
        root: splitLeaf(target, incoming, position),
        activePaneId: incoming.id,
        maximizedPaneId: null,
        broadcastActive: state.broadcastActive,
        splitTabActive: true,
      };
    });
  },

  splitPane: (targetPaneId, sessionId, position) => {
    set((state) => {
      if (!state.root) {
        const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
        return { root: leaf, activePaneId: leaf.id, splitTabActive: true };
      }
      const existing = findLeafBySession(state.root, sessionId);
      if (existing) return { activePaneId: existing.id, splitTabActive: true };
      const target = findLeaf(state.root, targetPaneId);
      if (!target) return {};
      const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
      return {
        root: replaceLeaf(state.root, targetPaneId, splitLeaf(target, leaf, position)),
        activePaneId: leaf.id,
        maximizedPaneId: null,
        splitTabActive: true,
      };
    });
  },

  movePane: (sourcePaneId, targetPaneId, position) => {
    set((state) => {
      if (!state.root || sourcePaneId === targetPaneId) return {};
      const { root: withoutSource, removed } = removeLeaf(state.root, sourcePaneId);
      if (!removed || !withoutSource) return {};
      const target = findLeaf(withoutSource, targetPaneId);
      if (!target) return { root: withoutSource };
      return {
        root: replaceLeaf(withoutSource, targetPaneId, splitLeaf(target, removed, position)),
        activePaneId: removed.id,
        maximizedPaneId: null,
        splitTabActive: true,
      };
    });
  },

  closePane: (paneId) => {
    set((state) => {
      if (!state.root) return {};
      const { root } = removeLeaf(state.root, paneId);
      if (root?.type === "leaf") {
        return {
          root: null,
          activePaneId: null,
          maximizedPaneId: null,
          broadcastActive: false,
          splitTabActive: false,
        };
      }
      const nextActive = findLeaf(root, state.activePaneId) ?? firstLeaf(root);
      return {
        root,
        activePaneId: nextActive?.id ?? null,
        maximizedPaneId: state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
        broadcastActive: root ? state.broadcastActive : false,
        splitTabActive: root ? state.splitTabActive : false,
      };
    });
  },

  removeSession: (sessionId) => {
    set((state) => {
      if (!state.root) return {};
      const root = removeSessionFromTree(state.root, sessionId);
      if (root?.type === "leaf") {
        return {
          root: null,
          activePaneId: null,
          maximizedPaneId: null,
          broadcastActive: false,
          splitTabActive: false,
        };
      }
      const nextActive = findLeaf(root, state.activePaneId) ?? firstLeaf(root);
      const maximizedLeaf = findLeaf(root, state.maximizedPaneId);
      return {
        root,
        activePaneId: nextActive?.id ?? null,
        maximizedPaneId: maximizedLeaf?.id ?? null,
        broadcastActive: root ? state.broadcastActive : false,
        splitTabActive: root ? state.splitTabActive : false,
      };
    });
  },

  setRatio: (splitNodeId, ratio) => {
    set((state) => ({ root: state.root ? updateRatio(state.root, splitNodeId, ratio) : null }));
  },

  setActivePane: (paneId) => set({ activePaneId: paneId, splitTabActive: true }),

  setMaximized: (paneId) => set({ maximizedPaneId: paneId }),

  toggleBroadcast: () => set((state) => ({ broadcastActive: !state.broadcastActive })),

  openSessions: (sessionIds) => {
    const uniqueIds = [...new Set(sessionIds)].filter(Boolean);
    set(() => {
      const leaves = uniqueIds.map((sessionId): LeafNode => ({ type: "leaf", id: newPaneId(), sessionId }));
      const root = buildBalancedTree(leaves);
      const activeLeaf = leaves[leaves.length - 1] ?? null;
      return {
        root,
        activePaneId: activeLeaf?.id ?? null,
        maximizedPaneId: null,
        splitTabActive: root !== null,
      };
    });
  },
}));
