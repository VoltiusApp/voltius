import { invoke } from "@tauri-apps/api/core";

/** Rejects if the listener did not come up — the caller must revert the toggle. */
export async function syncMcpServer(enabled: boolean): Promise<void> {
  await invoke("mcp_set_enabled", { enabled });
}
