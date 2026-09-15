import type { StatusTone } from "@voltius/ui";

export function containerStateTone(state: string): StatusTone {
  if (state === "running") return "connected";
  if (state === "paused") return "warning";
  return "idle";
}
