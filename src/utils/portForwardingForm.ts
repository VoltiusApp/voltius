import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";

export function ruleToForm(
  rule: PortForwardingRule,
  over: Partial<PortForwardingRuleFormData> = {},
): PortForwardingRuleFormData {
  return {
    name: rule.name,
    local_port: rule.local_port,
    remote_port: rule.remote_port,
    remote_host: rule.remote_host,
    tunnel_type: rule.tunnel_type ?? "local",
    bind_host: rule.bind_host ?? "127.0.0.1",
    target_host: rule.target_host ?? "127.0.0.1",
    description: rule.description,
    connection_ids: [...rule.connection_ids],
    folder_id: rule.folder_id,
    vault_id: rule.vault_id,
    ...over,
  };
}
