import type { StatusTone } from "@voltius/ui";

export function lxcStatusTone(status: string): StatusTone {
  return status === "running" ? "connected" : "idle";
}
