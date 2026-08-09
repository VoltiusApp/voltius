import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildMcpTools, listToolDescriptors, callTool, type McpTool } from "./consumer";
import { getMcpHostApi } from "./hostApi";
import { contributionsVersion } from "./contributions";
import { startToolsChangedNotifier } from "./notifyToolsChanged";

export interface BridgePayload {
  op: string;
  name?: string;
  args?: Record<string, unknown>;
  /** Identifies the connected client. Absent only from an older backend. */
  clientId?: string;
}

interface ClientState {
  /** Sessions THIS client opened. Per-client, so two concurrent clients cannot
   *  close each other's sessions. */
  owned: Set<string>;
  tools: McpTool[];
  version: number;
}

const _clients = new Map<string, ClientState>();

/** Test seam. */
export function resetClientTools(): void {
  _clients.clear();
}

function stateFor(clientId: string): ClientState {
  const version = contributionsVersion();
  const existing = _clients.get(clientId);
  if (existing && existing.version === version) return existing;
  // The owned set is hoisted out of the build and reused: rebuilding it with
  // the tools would orphan every session this client had opened, silently
  // making them unclosable.
  const owned = existing?.owned ?? new Set<string>();
  const next: ClientState = { owned, tools: buildMcpTools(getMcpHostApi(), owned), version };
  _clients.set(clientId, next);
  return next;
}

export async function handleBridgePayload(payload: BridgePayload): Promise<unknown> {
  const clientId = payload.clientId ?? "default";
  if (payload.op === "client_closed") {
    _clients.delete(clientId);
    return { ok: true };
  }
  const { tools } = stateFor(clientId);
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
  void listen<{ id: string; payload: BridgePayload }>("mcp-bridge-request", async (event) => {
    const { id, payload } = event.payload;
    let result: unknown;
    try {
      result = await handleBridgePayload(payload);
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
