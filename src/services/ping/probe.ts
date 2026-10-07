import { invoke } from "@/lib/invoke";
import { resolveJumpHosts } from "@/services/credentials";
import { firstHopProxy } from "@/services/proxy";
import { pingKnockWindow } from "@/services/portKnock";
import type { PingStatus } from "@/stores/hostPingStore";
import type { PingTarget } from "./pingTargets";

/// Comfortably above the slowest Rust-side timeout (8s for the jump chain),
/// so a stalled keychain read can't freeze a target in `inFlight` forever.
export const PROBE_TIMEOUT_MS = 15_000;

type PingOutcome = { up: number } | "down" | "knock_closed";

const fromOutcome = (o: PingOutcome): { status: PingStatus; latencyMs?: number } =>
  o === "knock_closed" ? { status: "knock" } : o === "down" ? { status: "down" } : { status: "up", latencyMs: o.up };

async function runProbe(target: PingTarget): Promise<{ status: PingStatus; latencyMs?: number }> {
  if (target.sessionId) {
    const latencyMs = await invoke<number | null>("ping_session", { sessionId: target.sessionId });
    if (latencyMs === null || latencyMs === undefined) return { status: "unknown" };
    return { status: "up", latencyMs };
  }

  const proxy = await firstHopProxy(target.connection);
  const knockWindowSecs = pingKnockWindow(target.connection);

  if (target.connection.jump_hosts?.length) {
    const jumpHosts = await resolveJumpHosts(target.connection);
    return fromOutcome(
      await invoke<PingOutcome>("ping_host_via_jumps", { host: target.host, port: target.port, jumpHosts, proxy, knockWindowSecs }),
    );
  }
  return fromOutcome(await invoke<PingOutcome>("ping_host", { host: target.host, port: target.port, proxy, knockWindowSecs }));
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
