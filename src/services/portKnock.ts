import type { PortKnockSettings } from "@/types";

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
