import { invoke } from "@tauri-apps/api/core";

export async function syncMcpServer(enabled: boolean): Promise<void> {
  try {
    await invoke("mcp_set_enabled", { enabled });
  } catch (err) {
    console.error("[mcp] could not change the server state", err);
  }
}
