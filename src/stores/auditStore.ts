import { create } from "zustand";
import { fetchAuditLogs, exportAuditLogs } from "@/services/auditService";
import { fetchLocalAuditLogs, exportLocalAuditLogs } from "@/services/localAuditService";
import type { AuditLog, AuditFilters } from "@/services/auditService";
import type { AuditContext } from "@/services/auditContext";

export type LayoutMode = "timeline" | "list";

const LAYOUT_KEY = "audit-layout-preference";

function defaultFilters(): AuditFilters {
  return {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    page: 1,
    per_page: 50,
  };
}

let fetchRequestSeq = 0;

interface AuditState {
  logs: AuditLog[];
  total: number;
  filters: AuditFilters;
  layout: LayoutMode;
  loading: boolean;
  error: string | null;
  fetchLogs: (context: AuditContext) => Promise<void>;
  setFilter: <K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) => void;
  resetFilters: () => void;
  setLayout: (mode: LayoutMode) => void;
  exportLogs: (context: AuditContext, format: "csv" | "json") => Promise<void>;
}

function savedLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === "list" || v === "timeline" ? v : "timeline";
  } catch {
    return "timeline";
  }
}

async function fetchForContext(context: AuditContext, filters: AuditFilters): Promise<{ logs: AuditLog[]; total: number }> {
  if (context.kind === "team") return fetchAuditLogs(context.teamId, filters);
  return fetchLocalAuditLogs(context.vaultId, filters);
}

async function exportForContext(
  context: AuditContext,
  filters: Omit<AuditFilters, "page" | "per_page">,
  format: "csv" | "json",
): Promise<Blob> {
  if (context.kind === "team") return exportAuditLogs(context.teamId, filters, format);
  return exportLocalAuditLogs(context.vaultId, filters, format);
}

export const useAuditStore = create<AuditState>((set, get) => ({
  logs: [],
  total: 0,
  filters: defaultFilters(),
  layout: savedLayout(),
  loading: false,
  error: null,

  async fetchLogs(context: AuditContext) {
    const requestId = ++fetchRequestSeq;
    set({ logs: [], total: 0, loading: true, error: null });
    try {
      const { logs, total } = await fetchForContext(context, get().filters);
      if (requestId !== fetchRequestSeq) return;
      set({ logs, total, loading: false });
    } catch (e) {
      if (requestId !== fetchRequestSeq) return;
      set({ loading: false, error: e instanceof Error ? e.message : "Failed to load logs" });
    }
  },

  setFilter(key, value) {
    const reset = key !== "page" ? { page: 1 } : {};
    set((s) => ({ filters: { ...s.filters, ...reset, [key]: value } }));
  },

  resetFilters() {
    set({ filters: defaultFilters() });
  },

  setLayout(mode) {
    try { localStorage.setItem(LAYOUT_KEY, mode); } catch {}
    set({ layout: mode });
  },

  async exportLogs(context, format) {
    const { filters } = get();
    const { page: _p, per_page: _pp, ...rest } = filters;
    const blob = await exportForContext(context, rest, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
}));
