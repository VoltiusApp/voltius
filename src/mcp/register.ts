import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildMcpTools, listToolDescriptors, callTool } from "./consumer";
import { getMcpHostApi } from "./hostApi";

interface BridgeRequest {
  id: string;
  payload: { op: string; name?: string; args?: Record<string, unknown> };
}

async function handle(payload: BridgeRequest["payload"]): Promise<unknown> {
  const tools = buildMcpTools(getMcpHostApi());
  if (payload.op === "tools/list") return { tools: listToolDescriptors(tools) };
  if (payload.op === "tools/call") {
    return callTool(tools, payload.name ?? "", payload.args ?? {});
  }
  return { ok: false, error: `unknown op "${payload.op}"` };
}

/** Every path must reply. A request left unanswered parks the MCP client until
 *  its timeout, which reads as the app being hung. */
export function registerMcpConsumer(): () => void {
  let stop: (() => void) | undefined;
  void listen<BridgeRequest>("mcp-bridge-request", async (event) => {
    const { id, payload } = event.payload;
    let result: unknown;
    try {
      result = await handle(payload);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await invoke("mcp_bridge_reply", { id, result });
  }).then((un) => { stop = un; });
  return () => stop?.();
}
