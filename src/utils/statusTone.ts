import type { TerminalSession } from "@/types";
import type { PingStatus } from "@/stores/hostPingStore";

export type StatusTone = "connected" | "connecting" | "warning" | "error" | "idle" | "accent";

export const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  connected: "var(--t-status-connected)",
  connecting: "var(--t-status-connecting)",
  warning: "var(--t-status-warning)",
  error: "var(--t-status-error)",
  idle: "var(--t-text-muted)",
  accent: "var(--t-accent)",
};

export function sessionStatusTone(status: TerminalSession["status"]): StatusTone {
  return status === "disconnected" ? "idle" : status;
}

export function pingStatusTone(status: PingStatus | undefined): StatusTone {
  return status === "up" ? "connected" : status === "down" ? "error" : "idle";
}

export function pingStatusMotion(status: PingStatus | undefined, fast = false): "ping" | "ping-fast" | undefined {
  if (status !== "up") return undefined;
  return fast ? "ping-fast" : "ping";
}

export function latencyTone(ms: number): StatusTone {
  if (ms < 50) return "connected";
  if (ms < 150) return "warning";
  return "error";
}

export function latencyColor(ms: number): string {
  return STATUS_TONE_COLOR[latencyTone(ms)];
}

export function tunnelStatusTone(status: "active" | "error" | "idle" | "inactive"): StatusTone {
  return status === "active" ? "connected" : status === "error" ? "error" : "idle";
}
