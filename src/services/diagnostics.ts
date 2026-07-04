import { invoke } from "@tauri-apps/api/core";
import { setLoggerVerbose } from "@/lib/logger";

export async function setVerboseLogging(enabled: boolean): Promise<void> {
  await invoke("set_verbose_logging", { enabled });
  setLoggerVerbose(enabled);
}

export function createBugReport(): Promise<string> {
  return invoke("create_bug_report");
}
