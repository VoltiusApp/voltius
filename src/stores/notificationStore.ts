import { create } from "zustand";
import type { ToastSeverity } from "@/plugins/api";

export interface ToastEntry {
  id: string;
  pluginId: string;
  pluginName: string;
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
  pluginId: string;
  pluginName: string;
  message: string;
  severity: ToastSeverity;
  actions: Array<{ label: string; onClick: () => void }>;
  dismissable: boolean;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  pluginId: string;
  pluginName: string;
  message: string;
  severity: ToastSeverity;
  dismissedAt: number;
}

const MAX_TOASTS = 5;
const MAX_BANNERS = 10;
const MAX_HISTORY = 50;

interface NotificationStore {
  toasts: ToastEntry[];
  banners: BannerEntry[];
  history: HistoryEntry[];
  unreadCount: number;

  addToast(entry: Omit<ToastEntry, "id" | "createdAt">): string;
  updateToast(id: string, patch: Partial<ToastEntry>): void;
  dismissToast(id: string): void;

  addBanner(entry: Omit<BannerEntry, "id" | "createdAt">): string;
  updateBanner(id: string, patch: Partial<BannerEntry>): void;
  dismissBanner(id: string): void;

  dismissAllForPlugin(pluginId: string): void;
  markAllRead(): void;
  clearHistory(): void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  toasts: [],
  banners: [],
  history: [],
  unreadCount: 0,

  addToast(entry) {
    const id = `${entry.pluginId}:${crypto.randomUUID()}`;
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
      return { toasts, unreadCount: s.unreadCount + 1 };
    });

    return id;
  },

  updateToast(id, patch) {
    set((s) => {
      if (!s.toasts.find((t) => t.id === id)) return s;
      return {
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      };
    });
  },

  dismissToast(id) {
    set((s) => {
      const toast = s.toasts.find((t) => t.id === id);
      if (!toast) return s;
      const historyEntry: HistoryEntry = {
        id: toast.id,
        pluginId: toast.pluginId,
        pluginName: toast.pluginName,
        message: toast.message,
        severity: toast.finishedSeverity ?? toast.severity,
        dismissedAt: Date.now(),
      };
      const history = [historyEntry, ...s.history].slice(0, MAX_HISTORY);
      return {
        toasts: s.toasts.filter((t) => t.id !== id),
        history,
      };
    });
  },

  addBanner(entry) {
    const id = `${entry.pluginId}:${crypto.randomUUID()}`;
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
      return { banners, unreadCount: s.unreadCount + 1 };
    });

    return id;
  },

  updateBanner(id, patch) {
    set((s) => ({
      banners: s.banners.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  },

  dismissBanner(id) {
    set((s) => ({ banners: s.banners.filter((b) => b.id !== id) }));
  },

  dismissAllForPlugin(pluginId) {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.pluginId !== pluginId),
      banners: s.banners.filter((b) => b.pluginId !== pluginId),
    }));
  },

  markAllRead() {
    set({ unreadCount: 0 });
  },

  clearHistory() {
    set({ history: [] });
  },
}));
