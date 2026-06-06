export type KeepalivePreset = "fast" | "balanced" | "tolerant" | "off";

export const DEFAULT_KEEPALIVE_PRESET: KeepalivePreset = "fast";

// intervalSecs 0 disables keepalive. Detection time ≈ intervalSecs × max.
export const KEEPALIVE_PRESETS: Record<
  KeepalivePreset,
  { intervalSecs: number; max: number; label: string; detail: string }
> = {
  fast: { intervalSecs: 2, max: 2, label: "Fast", detail: "Detects a dropped connection in ~4s" },
  balanced: { intervalSecs: 3, max: 3, label: "Balanced", detail: "~9s; tolerates a brief network blip" },
  tolerant: { intervalSecs: 5, max: 4, label: "Tolerant", detail: "~20s; for flaky networks" },
  off: { intervalSecs: 0, max: 0, label: "Off", detail: "No keepalive probes" },
};

export function resolveKeepalive(preset: KeepalivePreset): { intervalSecs: number; max: number } {
  const { intervalSecs, max } = KEEPALIVE_PRESETS[preset] ?? KEEPALIVE_PRESETS[DEFAULT_KEEPALIVE_PRESET];
  return { intervalSecs, max };
}
