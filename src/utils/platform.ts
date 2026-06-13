import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Host OS reported by the Rust backend (`get_platform`): "android" | "ios" |
 * "linux" | "macos" | "windows". Resolved once and cached for the session.
 *
 * Used to hide host-integration features the platform sandbox can't support
 * (local terminal, serial, local Docker). This is UX gating only — the backend
 * already fails those operations cleanly; never rely on it for security.
 */
let cached: Promise<string> | null = null;

export function getPlatform(): Promise<string> {
  if (!cached) cached = invoke<string>("get_platform").catch(() => "unknown");
  return cached;
}

/** React hook: the OS string, or `null` until it resolves. */
export function usePlatform(): string | null {
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getPlatform().then((p) => alive && setOs(p));
    return () => {
      alive = false;
    };
  }, []);
  return os;
}

/** True only once the platform is confirmed Android (false while loading). */
export function useIsAndroid(): boolean {
  return usePlatform() === "android";
}
