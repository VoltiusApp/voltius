import { invoke } from "@/lib/invoke";

export interface McpStatus {
  enabled: boolean;
  socketPath: string;
  exePath: string;
}

export async function getMcpStatus(): Promise<McpStatus> {
  return invoke("mcp_status");
}
