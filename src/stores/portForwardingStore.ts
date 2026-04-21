import { create } from "zustand";
import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import * as api from "@/services/portForwardingRules";

interface PortForwardingStore {
  rules: PortForwardingRule[];
  loading: boolean;
  loadRules: () => Promise<void>;
  createRule: (data: PortForwardingRuleFormData) => Promise<PortForwardingRule>;
  updateRule: (id: string, data: PortForwardingRuleFormData) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  duplicateRule: (id: string) => Promise<PortForwardingRule>;
  moveRuleFolder: (id: string, folderId: string | null) => Promise<void>;
}

export const usePortForwardingStore = create<PortForwardingStore>((set) => ({
  rules: [],
  loading: false,

  loadRules: async () => {
    set({ loading: true });
    const rules = await api.listPfRules();
    set({ rules, loading: false });
  },

  createRule: async (data) => {
    const rule = await api.createPfRule(data);
    const rules = await api.listPfRules();
    set({ rules });
    return rule;
  },

  updateRule: async (id, data) => {
    await api.updatePfRule(id, data);
    const rules = await api.listPfRules();
    set({ rules });
  },

  deleteRule: async (id) => {
    await api.deletePfRule(id);
    const rules = await api.listPfRules();
    set({ rules });
  },

  duplicateRule: async (id) => {
    const rule = await api.duplicatePfRule(id);
    const rules = await api.listPfRules();
    set({ rules });
    return rule;
  },

  moveRuleFolder: async (id, folderId) => {
    await api.movePfRuleFolder(id, folderId);
    const rules = await api.listPfRules();
    set({ rules });
  },
}));
