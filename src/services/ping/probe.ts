import { invoke } from "@tauri-apps/api/core";
import { resolveJumpHosts } from "@/services/credentials";
import type { PingStatus } from "@/stores/hostPingStore";
import type { PingTarget } from "./pingTargets";

export async function probeTarget(
  target: PingTarget,
): Promise<{ status: PingStatus; latencyMs?: number }> {
  try {
    let latencyMs: number | null | undefined;

    if (target.sessionId) {
      latencyMs = await invoke<number | null>("ping_session", { sessionId: target.sessionId });
    } else if (target.connection.jump_hosts?.length) {
      const jumpHosts = await resolveJumpHosts(target.connection);
      latencyMs = await invoke<number | null>("ping_host_via_jumps", {
        host: target.host,
        port: target.port,
        jumpHosts,
      });
    } else {
      latencyMs = await invoke<number | null>("ping_host", { host: target.host, port: target.port });
    }

    if (latencyMs === null || latencyMs === undefined) return { status: "down" };
    return { status: "up", latencyMs };
  } catch {
    return { status: "unknown" };
  }
}
