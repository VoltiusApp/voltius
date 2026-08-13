import { create } from "zustand";
import type { ToastSeverity } from "@/plugins/api";

export type NotificationSource =
  | { kind: "plugin"; id: string; name: string }
  | { kind: "app"; area: "team" };

export function sourceKey(source: NotificationSource): string {
  return source.kind === "plugin" ? source.id : "app";
}

export interface ToastEntry {
  id: string;
  source: NotificationSource;
  type: "toast" | "progress";
  message: string;
  severity: ToastSeverity;
  duration: number;
  action?: { label: string; onClick: () => void };
  // Progress fields
  progress?: number;
  cancellable?: boolean;
  onCancel?: () => void;
  finished?: boolean;
  finishedSeverity?: ToastSeverity;
  timedOutAt?: number;
  // Meta
  createdAt: number;
}

export interface BannerEntry {
  id: string;
  source: NotificationSource;
  message: string;
  severity: ToastSeverity;
  actions: Array<{ label: string; onClick: () => void }>;
  dismissable: boolean;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  source: NotificationSource;
  message: string;
  severity: ToastSeverity;
  dismissedAt: number;
}

export type InboxKind =
  | "invite"
  | "sessionShared"
  | "controlRequest"
  | "controlGranted"
  | "awaitingKey";

export interface InboxAction {
  label: string;
  run: () => Promise<void>;
}

export interface InboxEntry {
  id: string;
  source: NotificationSource;
  kind: InboxKind;
  message: string;
  actions: InboxAction[];
  state: "pending" | "acting" | "resolved";
  resolution?: string;
  createdAt: number;
}

const MAX_TOASTS = 5;
const MAX_BANNERS = 10;
const MAX_HISTORY = 50;

function updateById<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

interface NotificationStore {
  toasts: ToastEntry[];
  banners: BannerEntry[];
  history: HistoryEntry[];
  inbox: InboxEntry[];

  addToast(entry: Omit<ToastEntry, "id" | "createdAt">): string;
  updateToast(id: string, patch: Partial<ToastEntry>): void;
  dismissToast(id: string): void;

  addBanner(entry: Omit<BannerEntry, "id" | "createdAt">): string;
  updateBanner(id: string, patch: Partial<BannerEntry>): void;
  dismissBanner(id: string): void;

  upsertInbox(entry: Omit<InboxEntry, "state" | "createdAt"> & { state?: InboxEntry["state"] }): void;
  retractInbox(id: string): void;
  resolveInbox(id: string, resolution: string): void;
  runInboxAction(id: string, index: number): Promise<void>;

  dismissAllForPlugin(pluginId: string): void;
  unreadCount(): number;
  clearHistory(): void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  toasts: [],
  banners: [],
  history: [],
  inbox: [],

  addToast(entry) {
    const id = `${sourceKey(entry.source)}:${crypto.randomUUID()}`;
    const toast: ToastEntry = { ...entry, id, createdAt: Date.now() };

    set((s) => {
      let toasts = [...s.toasts, toast];
      // Overflow: drop oldest non-sticky, non-progress toast if over limit
      if (toasts.length > MAX_TOASTS) {
        const dropIdx = toasts.findIndex(
          (t) => t.type === "toast" && t.duration > 0
        );
        if (dropIdx !== -1) {
          toasts = toasts.filter((_, i) => i !== dropIdx);
        } else {
          // All protected — drop incoming
          return s;
        }
      }
      return { toasts };
    });

    return id;
  },

  updateToast(id, patch) {
    set((s) => {
      if (!s.toasts.find((t) => t.id === id)) return s;
      return { toasts: updateById(s.toasts, id, patch) };
    });
  },

  dismissToast(id) {
    set((s) => {
      const toast = s.toasts.find((t) => t.id === id);
      if (!toast) return s;
      const historyEntry: HistoryEntry = {
        id: toast.id,
        source: toast.source,
        message: toast.message,
        severity: toast.finishedSeverity ?? toast.severity,
        dismissedAt: Date.now(),
      };
      const history = [historyEntry, ...s.history].slice(0, MAX_HISTORY);
      return {
        toasts: removeById(s.toasts, id),
        history,
      };
    });
  },

  addBanner(entry) {
    const id = `${sourceKey(entry.source)}:${crypto.randomUUID()}`;
    const banner: BannerEntry = { ...entry, id, createdAt: Date.now() };

    set((s) => {
      let banners = [...s.banners, banner];
      if (banners.length > MAX_BANNERS) {
        const dropIdx = banners.findIndex((b) => b.dismissable);
        if (dropIdx !== -1) {
          banners = banners.filter((_, i) => i !== dropIdx);
        } else {
          return s;
        }
      }
      return { banners };
    });

    return id;
  },

  updateBanner(id, patch) {
    set((s) => ({ banners: updateById(s.banners, id, patch) }));
  },

  dismissBanner(id) {
    set((s) => ({ banners: removeById(s.banners, id) }));
  },

  dismissAllForPlugin(pluginId) {
    const belongsToPlugin = (e: { source: NotificationSource }) =>
      e.source.kind === "plugin" && e.source.id === pluginId;
    set((s) => ({
      toasts: s.toasts.filter((t) => !belongsToPlugin(t)),
      banners: s.banners.filter((b) => !belongsToPlugin(b)),
    }));
  },

  upsertInbox(entry) {
    set((s) => {
      const existing = s.inbox.find((e) => e.id === entry.id);
      if (!existing) {
        return {
          inbox: [...s.inbox, { ...entry, state: entry.state ?? "pending", createdAt: Date.now() }],
        };
      }
      return {
        inbox: s.inbox.map((e) =>
          e.id === entry.id ? { ...e, ...entry, state: entry.state ?? e.state, createdAt: e.createdAt } : e,
        ),
      };
    });
  },

  retractInbox(id) {
    set((s) => ({ inbox: removeById(s.inbox, id) }));
  },

  resolveInbox(id, resolution) {
    set((s) => ({ inbox: updateById(s.inbox, id, { state: "resolved", resolution }) }));
  },

  async runInboxAction(id, index) {
    const entry = get().inbox.find((e) => e.id === id);
    if (!entry || entry.state !== "pending") return;
    const action = entry.actions[index];
    if (!action) return;
    set((s) => ({ inbox: updateById(s.inbox, id, { state: "acting" }) }));
    try {
      await action.run();
      // Deliberately no retract here: the reconciler owns retraction when the
      // source row disappears, so success alone must not remove the entry.
    } catch {
      set((s) => ({ inbox: updateById(s.inbox, id, { state: "pending" }) }));
    }
  },

  unreadCount() {
    const s = get();
    return s.banners.length + s.inbox.filter((e) => e.state !== "resolved").length;
  },

  clearHistory() {
    set({ history: [] });
  },
}));
