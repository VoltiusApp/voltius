import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildMcpTools, listToolDescriptors, callTool, type McpTool } from "./consumer";
import { getMcpHostApi } from "./hostApi";
import { startToolsChangedNotifier } from "./notifyToolsChanged";

interface BridgeRequest {
  id: string;
  payload: { op: string; name?: string; args?: Record<string, unknown> };
}

// Built once and reused across requests, like hostApi's own `cached`: the
// `owned` set inside these tools (see coreTools.ts) is what makes
// "MCP may close only what MCP opened" hold across separate JSON-RPC calls.
let cachedTools: McpTool[] | null = null;
function getTools(): McpTool[] {
  cachedTools ??= buildMcpTools(getMcpHostApi(), new Set<string>());
  return cachedTools;
}

async function handle(payload: BridgeRequest["payload"]): Promise<unknown> {
  const tools = getTools();
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
  const stopNotifier = startToolsChangedNotifier();
  void listen<BridgeRequest>("mcp-bridge-request", async (event) => {
    const { id, payload } = event.payload;
    let result: unknown;
    try {
      result = await handle(payload);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await invoke("mcp_bridge_reply", { id, result });
  }).then((un) => {
    stop = un;
    // Reopens the gate the backend closed on reload start (or, on first
    // boot, confirms it's open). Requests that arrive before this resolves
    // are rejected immediately instead of registering against a listener
    // that isn't attached yet.
    void invoke("mcp_consumer_ready");
  });
  return () => {
    stopNotifier();
    stop?.();
  };
}
