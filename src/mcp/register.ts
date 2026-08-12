import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildMcpTools, listToolDescriptors, callTool, type McpTool } from "./consumer";
import { getMcpHostApi } from "./hostApi";
import { contributionsVersion } from "./contributions";
import { startToolsChangedNotifier } from "./notifyToolsChanged";
import { useMcpOwnershipStore } from "@/stores/mcpOwnershipStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { OwnedSessions } from "@voltius/tools";

/** A fast run_command would otherwise begin and end inside one frame and never
 *  render as a pulse. */
const ACTIVITY_HOLD_MS = 600;

export interface BridgePayload {
  op: string;
  name?: string;
  args?: Record<string, unknown>;
  /** Identifies the connected client. Both transports always stamp it; a
   *  payload without one is rejected rather than sharing a bucket. */
  clientId?: string;
  /** Display-only name the client reported. Attacker-chosen text: never use
   *  it for authorization or as a lookup key. */
  clientName?: string;
}

function ownedSessionsFor(clientId: string, name: () => string): OwnedSessions {
  const store = () => useMcpOwnershipStore.getState();
  return {
    has: (id) => store().owners[id]?.clientId === clientId,
    add: (id) => store().claim(id, { clientId, clientName: name() }),
    delete: (id) => {
      const had = store().owners[id]?.clientId === clientId;
      if (had) store().release(id);
      return had;
    },
  };
}

interface ClientState {
  /** Sessions THIS client opened. Per-client, so two concurrent clients cannot
   *  close each other's sessions. */
  owned: OwnedSessions;
  /** Latest name this client reported, read at claim time. */
  clientName: string;
  tools: McpTool[];
  version: number;
}

const _clients = new Map<string, ClientState>();

/** Test seam. */
export function resetClientTools(): void {
  _clients.clear();
}

function stateFor(clientId: string, clientName: string): ClientState {
  const version = contributionsVersion();
  const existing = _clients.get(clientId);
  if (existing) existing.clientName = clientName || existing.clientName;
  if (existing && existing.version === version) return existing;
  // Stateless — reads live off the store by clientId — so a fresh instance
  // behaves identically to the previous one; no reuse needed to avoid orphaning.
  const owned = ownedSessionsFor(clientId, () => _clients.get(clientId)?.clientName ?? "");
  const next: ClientState = {
    owned,
    clientName: clientName || existing?.clientName || "",
    tools: buildMcpTools(getMcpHostApi(), owned),
    version,
  };
  _clients.set(clientId, next);
  return next;
}

export async function handleBridgePayload(payload: BridgePayload): Promise<unknown> {
  const clientId = payload.clientId;
  // Fails closed: a shared fallback bucket would let one client close another's
  // sessions and inherit its cached tool list.
  if (!clientId) return { ok: false, error: "missing clientId" };
  if (payload.op === "client_closed") {
    _clients.delete(clientId);
    useMcpOwnershipStore.getState().clearClient(clientId);
    return { ok: true };
  }
  const { tools } = stateFor(clientId, payload.clientName ?? "");
  if (payload.op === "tools/list") return { tools: listToolDescriptors(tools) };
  if (payload.op === "tools/call") {
    const args = payload.args ?? {};
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : null;
    const store = useMcpOwnershipStore.getState();
    if (sessionId) store.beginActivity(sessionId);
    try {
      return await callTool(tools, payload.name ?? "", args);
    } finally {
      // finally, not after the await: a throwing tool would otherwise leave the
      // tab pulsing for the rest of the app's life.
      if (sessionId) setTimeout(() => useMcpOwnershipStore.getState().endActivity(sessionId), ACTIVITY_HOLD_MS);
    }
  }
  return { ok: false, error: `unknown op "${payload.op}"` };
}

/** Every path must reply. A request left unanswered parks the MCP client until
 *  its timeout, which reads as the app being hung. */
export function registerMcpConsumer(): () => void {
  let stop: (() => void) | undefined;
  const stopNotifier = startToolsChangedNotifier();
  const stopPrune = useSessionStore.subscribe((s) =>
    useMcpOwnershipStore.getState().keepOnly(s.sessions.map((x) => x.id)),
  );
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
    stopPrune();
    stop?.();
  };
}
