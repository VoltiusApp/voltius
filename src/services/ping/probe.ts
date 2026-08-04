import { invoke } from "@tauri-apps/api/core";
import { resolveJumpHosts } from "@/services/credentials";
import type { PingStatus } from "@/stores/hostPingStore";
import type { PingTarget } from "./pingTargets";

/// Comfortably above the slowest Rust-side timeout (8s for the jump chain),
/// so a stalled keychain read can't freeze a target in `inFlight` forever.
export const PROBE_TIMEOUT_MS = 15_000;

async function runProbe(target: PingTarget): Promise<{ status: PingStatus; latencyMs?: number }> {
  let latencyMs: number | null | undefined;

  if (target.sessionId) {
    latencyMs = await invoke<number | null>("ping_session", { sessionId: target.sessionId });
    if (latencyMs === null || latencyMs === undefined) return { status: "unknown" };
    return { status: "up", latencyMs };
  }

  if (target.connection.jump_hosts?.length) {
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
}

export async function probeTarget(
  target: PingTarget,
): Promise<{ status: PingStatus; latencyMs?: number }> {
  try {
    return await Promise.race([
      runProbe(target),
      new Promise<{ status: PingStatus }>((resolve) => {
        setTimeout(() => resolve({ status: "unknown" }), PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { status: "unknown" };
  }
}
