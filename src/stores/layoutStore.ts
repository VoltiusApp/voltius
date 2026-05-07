import { create } from "zustand";
import { mergeTitlebarItems, placeTitlebarItem } from "@/utils/titlebarOrder";

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

export interface SplitTab {
  id: string;
  root: PaneNode;
  activePaneId: string | null;
  maximizedPaneId: string | null;
  broadcastActive: boolean;
}

interface LayoutStore {
  root: PaneNode | null;
  activePaneId: string | null;
  maximizedPaneId: string | null;
  broadcastActive: boolean;
  splitTabActive: boolean;
  splitTabs: SplitTab[];
  activeSplitTabId: string | null;
  titlebarOrder: string[];

  openSplitTab(sessionId?: string): void;
  setSplitTabActive(active: boolean): void;
  activateSplitTab(tabId: string): void;
  closeSplitTab(tabId: string): void;
  syncTitlebarOrder(visibleKeys: string[]): void;
  placeTitlebarItem(itemKey: string, targetKey: string | null, placement: "before" | "after"): void;
  reorderTitlebarItem(sourceKey: string, targetKey: string | null, placement: "before" | "after"): void;
  createSplitTab(targetSessionId: string, incomingSessionId: string, position: SplitPosition): void;
  splitPane(targetPaneId: string, sessionId: string, position: SplitPosition): void;
  movePane(sourcePaneId: string, targetPaneId: string, position: SplitPosition): void;
  detachPane(paneId: string): string | null;
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
const newSplitTabId = () => `split-tab-${crypto.randomUUID()}`;

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

function fieldsFromTab(tab: SplitTab | null) {
  return {
    root: tab?.root ?? null,
    activePaneId: tab?.activePaneId ?? null,
    maximizedPaneId: tab?.maximizedPaneId ?? null,
    broadcastActive: tab?.broadcastActive ?? false,
    activeSplitTabId: tab?.id ?? null,
    splitTabActive: tab !== null,
  };
}

function updateActiveSplitTab(state: LayoutStore, updates: Partial<Omit<SplitTab, "id">>) {
  if (!state.activeSplitTabId) return {};
  return {
    splitTabs: state.splitTabs.map((tab) => tab.id === state.activeSplitTabId ? { ...tab, ...updates } : tab),
  };
}

function createSplitTabState(root: PaneNode, activePaneId: string | null, broadcastActive = false): SplitTab {
  return {
    id: newSplitTabId(),
    root,
    activePaneId,
    maximizedPaneId: null,
    broadcastActive,
  };
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  root: null,
  activePaneId: null,
  maximizedPaneId: null,
  broadcastActive: false,
  splitTabActive: false,
  splitTabs: [],
  activeSplitTabId: null,
  titlebarOrder: [],

  openSplitTab: (sessionId) => {
    set((state) => {
      if (!sessionId) return { splitTabActive: true };
      const existing = findLeafBySession(state.root, sessionId);
      if (existing) {
        return { ...updateActiveSplitTab(state, { activePaneId: existing.id }), activePaneId: existing.id, splitTabActive: true };
      }
      if (!state.root) {
        const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
        const tab = createSplitTabState(leaf, leaf.id);
        return { splitTabs: [...state.splitTabs, tab], ...fieldsFromTab(tab) };
      }
      const target = findLeaf(state.root, state.activePaneId) ?? firstLeaf(state.root);
      if (!target) return { splitTabActive: true };
      const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
      const root = replaceLeaf(state.root, target.id, splitLeaf(target, leaf, "right"));
      return {
        ...updateActiveSplitTab(state, { root, activePaneId: leaf.id, maximizedPaneId: null }),
        root,
        activePaneId: leaf.id,
        maximizedPaneId: null,
        splitTabActive: true,
      };
    });
  },

  setSplitTabActive: (active) => set({ splitTabActive: active }),

  activateSplitTab: (tabId) => {
    set((state) => {
      const tab = state.splitTabs.find((candidate) => candidate.id === tabId);
      if (!tab) return {};
      return fieldsFromTab(tab);
    });
  },

  closeSplitTab: (tabId) => {
    set((state) => {
      const splitTabs = state.splitTabs.filter((tab) => tab.id !== tabId);
      if (state.activeSplitTabId !== tabId) return { splitTabs };
      const nextTab = splitTabs[splitTabs.length - 1] ?? null;
      return { splitTabs, titlebarOrder: state.titlebarOrder.filter((key) => key !== `split:${tabId}`), ...fieldsFromTab(nextTab) };
    });
  },

  placeTitlebarItem: (itemKey, targetKey, placement) => set((state) => ({
    titlebarOrder: placeTitlebarItem(state.titlebarOrder, itemKey, targetKey, placement),
  })),

  syncTitlebarOrder: (visibleKeys) => set((state) => {
    const titlebarOrder = mergeTitlebarItems(state.titlebarOrder, visibleKeys);
    if (titlebarOrder.length === state.titlebarOrder.length && titlebarOrder.every((key, index) => key === state.titlebarOrder[index])) return {};
    return { titlebarOrder };
  }),

  reorderTitlebarItem: (sourceKey, targetKey, placement) => set((state) => {
    if (sourceKey === targetKey) return {};
    return { titlebarOrder: placeTitlebarItem(state.titlebarOrder, sourceKey, targetKey, placement) };
  }),

  createSplitTab: (targetSessionId, incomingSessionId, position) => {
    set((state) => {
      if (targetSessionId === incomingSessionId) return {};
      const target: LeafNode = { type: "leaf", id: newPaneId(), sessionId: targetSessionId };
      const incoming: LeafNode = { type: "leaf", id: newPaneId(), sessionId: incomingSessionId };
      const root = splitLeaf(target, incoming, position);
      const tab = createSplitTabState(root, incoming.id, state.broadcastActive);
      return { splitTabs: [...state.splitTabs, tab], ...fieldsFromTab(tab) };
    });
  },

  splitPane: (targetPaneId, sessionId, position) => {
    set((state) => {
      if (!state.root) {
        const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
        const tab = createSplitTabState(leaf, leaf.id);
        return { splitTabs: [...state.splitTabs, tab], ...fieldsFromTab(tab) };
      }
      const existing = findLeafBySession(state.root, sessionId);
      if (existing) return { ...updateActiveSplitTab(state, { activePaneId: existing.id }), activePaneId: existing.id, splitTabActive: true };
      const target = findLeaf(state.root, targetPaneId);
      if (!target) return {};
      const leaf: LeafNode = { type: "leaf", id: newPaneId(), sessionId };
      const root = replaceLeaf(state.root, targetPaneId, splitLeaf(target, leaf, position));
      return {
        ...updateActiveSplitTab(state, { root, activePaneId: leaf.id, maximizedPaneId: null }),
        root,
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
      if (!target) return { ...updateActiveSplitTab(state, { root: withoutSource }), root: withoutSource };
      const root = replaceLeaf(withoutSource, targetPaneId, splitLeaf(target, removed, position));
      return {
        ...updateActiveSplitTab(state, { root, activePaneId: removed.id, maximizedPaneId: null }),
        root,
        activePaneId: removed.id,
        maximizedPaneId: null,
        splitTabActive: true,
      };
    });
  },

  detachPane: (paneId) => {
    let detachedSessionId: string | null = null;

    set((state) => {
      if (!state.root) return {};

      const removedLeaf = findLeaf(state.root, paneId);
      if (!removedLeaf) return {};
      detachedSessionId = removedLeaf.sessionId;

      const { root } = removeLeaf(state.root, paneId);
      if (!root || root.type === "leaf") {
        const splitTabs = state.splitTabs.filter((tab) => tab.id !== state.activeSplitTabId);
        const nextTab = splitTabs[splitTabs.length - 1] ?? null;
        return {
          splitTabs,
          titlebarOrder: state.titlebarOrder.filter((key) => key !== `split:${state.activeSplitTabId}`),
          ...fieldsFromTab(nextTab),
        };
      }

      const nextActive = findLeaf(root, state.activePaneId) ?? firstLeaf(root);
      return {
        ...updateActiveSplitTab(state, {
          root,
          activePaneId: nextActive?.id ?? null,
          maximizedPaneId: state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
          broadcastActive: root ? state.broadcastActive : false,
        }),
        root,
        activePaneId: nextActive?.id ?? null,
        maximizedPaneId: state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
        broadcastActive: root ? state.broadcastActive : false,
        splitTabActive: root ? state.splitTabActive : false,
      };
    });

    return detachedSessionId;
  },

  closePane: (paneId) => {
    set((state) => {
      if (!state.root) return {};
      const { root } = removeLeaf(state.root, paneId);
      if (!root || root.type === "leaf") {
        const splitTabs = state.splitTabs.filter((tab) => tab.id !== state.activeSplitTabId);
        const nextTab = splitTabs[splitTabs.length - 1] ?? null;
        return {
          splitTabs,
          titlebarOrder: state.titlebarOrder.filter((key) => key !== `split:${state.activeSplitTabId}`),
          ...fieldsFromTab(nextTab),
        };
      }
      const nextActive = findLeaf(root, state.activePaneId) ?? firstLeaf(root);
      return {
        ...updateActiveSplitTab(state, {
          root: root!,
          activePaneId: nextActive?.id ?? null,
          maximizedPaneId: state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
          broadcastActive: root ? state.broadcastActive : false,
        }),
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
      const splitTabs = state.splitTabs.flatMap((tab): SplitTab[] => {
        const root = removeSessionFromTree(tab.root, sessionId);
        if (!root || root.type === "leaf") return [];
        const nextActive = findLeaf(root, tab.activePaneId) ?? firstLeaf(root);
        const maximizedLeaf = findLeaf(root, tab.maximizedPaneId);
        return [{
          ...tab,
          root,
          activePaneId: nextActive?.id ?? null,
          maximizedPaneId: maximizedLeaf?.id ?? null,
        }];
      });
      const activeTab = splitTabs.find((tab) => tab.id === state.activeSplitTabId) ?? splitTabs[splitTabs.length - 1] ?? null;
      return { splitTabs, titlebarOrder: state.titlebarOrder.filter((key) => key !== `session:${sessionId}`), ...fieldsFromTab(activeTab) };
    });
  },

  setRatio: (splitNodeId, ratio) => {
    set((state) => {
      const root = state.root ? updateRatio(state.root, splitNodeId, ratio) : null;
      return { ...updateActiveSplitTab(state, root ? { root } : {}), root };
    });
  },

  setActivePane: (paneId) => set((state) => ({
    ...updateActiveSplitTab(state, { activePaneId: paneId }),
    activePaneId: paneId,
    splitTabActive: true,
  })),

  setMaximized: (paneId) => set((state) => ({
    ...updateActiveSplitTab(state, { maximizedPaneId: paneId }),
    maximizedPaneId: paneId,
  })),

  toggleBroadcast: () => set((state) => {
    const broadcastActive = !state.broadcastActive;
    return { ...updateActiveSplitTab(state, { broadcastActive }), broadcastActive };
  }),

  openSessions: (sessionIds) => {
    const uniqueIds = [...new Set(sessionIds)].filter(Boolean);
    set((state) => {
      const leaves = uniqueIds.map((sessionId): LeafNode => ({ type: "leaf", id: newPaneId(), sessionId }));
      const root = buildBalancedTree(leaves);
      const activeLeaf = leaves[leaves.length - 1] ?? null;
      if (!root) return {};
      const tab = createSplitTabState(root, activeLeaf?.id ?? null);
      return {
        splitTabs: [...state.splitTabs, tab],
        ...fieldsFromTab(tab),
      };
    });
  },
}));
