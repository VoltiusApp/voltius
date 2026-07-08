import { invoke } from "@tauri-apps/api/core";
import { setLoggerVerbose } from "@/lib/logger";

export async function setVerboseLogging(enabled: boolean): Promise<void> {
  await invoke("set_verbose_logging", { enabled });
  setLoggerVerbose(enabled);
}

export function createBugReport(): Promise<string> {
  return invoke("create_bug_report");
}

/**
 * DIAGNOSTIC: record a frontend startup milestone into the flushed native trace
 * file (%TEMP%/voltius-startup-trace.log). Fire-and-forget; used to see how far
 * startup gets before a hang, even when the app is force-quit mid-freeze.
 */
export function startupPing(stage: string): void {
  void invoke("startup_ping", { stage }).catch(() => {});
}
