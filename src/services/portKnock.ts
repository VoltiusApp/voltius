import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { findConnection } from "@/services/credentials";
import { knockSequenceKey } from "@/services/teamVaultSecretKeys";
import type { Connection, PortKnockSettings } from "@/types";

export type KnockProtocol = "tcp" | "udp";
export interface KnockStep { port: number; protocol: KnockProtocol }
export interface KnockSpec { steps: KnockStep[]; delay_ms: number; settle_ms: number }

export const KNOCK_DEFAULTS = { delay_ms: 200, settle_ms: 500 } as const;
export const MAX_KNOCK_STEPS = 16;

export class KnockSequenceError extends Error {
  constructor(readonly reason: "empty" | "port" | "protocol" | "too-many") {
    super(`invalid knock sequence: ${reason}`);
  }
}

export const formatKnockSequence = (steps: KnockStep[]): string =>
  steps.map((s) => `${s.port}/${s.protocol}`).join(",");

export function parseKnockSequence(text: string): KnockStep[] {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new KnockSequenceError("empty");
  if (parts.length > MAX_KNOCK_STEPS) throw new KnockSequenceError("too-many");
  return parts.map((part) => {
    const [portText, protocol = "tcp"] = part.split("/");
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KnockSequenceError("port");
    if (protocol !== "tcp" && protocol !== "udp") throw new KnockSequenceError("protocol");
    return { port, protocol };
  });
}

export const toKnockSpec = (settings: PortKnockSettings, sequence: string): KnockSpec => ({
  steps: parseKnockSequence(sequence),
  delay_ms: settings.delay_ms ?? KNOCK_DEFAULTS.delay_ms,
  settle_ms: settings.settle_ms ?? KNOCK_DEFAULTS.settle_ms,
});

export interface KnockOverride { settings: PortKnockSettings | null; sequence?: string }

export function firstHopConnection(conn: Connection): Connection | undefined {
  const firstJump = conn.jump_hosts?.[0];
  return firstJump ? findConnection(firstJump.connection_id) : conn;
}

export function pingKnockWindow(conn: Connection): number | null {
  const knock = firstHopConnection(conn)?.port_knock;
  return knock?.enabled ? (knock.window_secs ?? 0) : null;
}

export const knocksOnConnect = (conn: Connection): boolean => pingKnockWindow(conn) !== null;

export async function resolveKnock(
  conn: Pick<Connection, "id" | "port_knock"> | undefined,
  override?: KnockOverride,
): Promise<KnockSpec | null> {
  const settings = override ? override.settings : conn?.port_knock;
  if (!conn || !settings?.enabled) return null;
  const sequence = override?.sequence ?? (await getSecret(knockSequenceKey(conn.id)).catch(() => null));
  if (!sequence) throw new Error(i18n.t("connections.knock.sequenceUnavailable"));
  try {
    return toKnockSpec(settings, sequence);
  } catch {
    throw new Error(i18n.t("connections.knock.sequenceInvalid"));
  }
}
