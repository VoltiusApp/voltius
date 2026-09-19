import type { TFunction } from "i18next";
import type { TerminalSession } from "@/types";

export function formatSince(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function sessionStatusLine(session: TerminalSession, since: number | null, now: number, t: TFunction): string {
  const key = "layout.titleBar.stack.status.";
  switch (session.status) {
    case "connected": return t(`${key}connected`, { time: formatSince(since === null ? 0 : now - since) });
    case "connecting":
      if (session.reconnectWait === "offline") return t(`${key}offline`);
      if (session.reconnectWait === "slow") return t(`${key}reconnecting`);
      return t(`${key}connecting`);
    case "disconnected": return t(`${key}disconnected`);
    case "error": return t(`${key}error`, { message: session.errorMessage ?? "" });
    default: return session.status satisfies never;
  }
}
