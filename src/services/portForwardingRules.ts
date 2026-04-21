import { invoke } from "@tauri-apps/api/core";
import type { PortForwardingRule, PortForwardingRuleFormData } from "../types";

export function listPfRules(): Promise<PortForwardingRule[]> {
  return invoke("pf_rule_list");
}

export function createPfRule(data: PortForwardingRuleFormData): Promise<PortForwardingRule> {
  return invoke("pf_rule_create", { data });
}

export function updatePfRule(id: string, data: PortForwardingRuleFormData): Promise<PortForwardingRule> {
  return invoke("pf_rule_update", { id, data });
}

export function deletePfRule(id: string): Promise<void> {
  return invoke("pf_rule_delete", { id });
}

export function duplicatePfRule(id: string): Promise<PortForwardingRule> {
  return invoke("pf_rule_duplicate", { id });
}

export function movePfRuleFolder(id: string, folderId: string | null): Promise<void> {
  return invoke("pf_rule_move_folder", { id, folderId });
}
