import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

export type UpdaterStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "downloading"; version: string; progress: number }
  | { status: "ready"; version: string }
  | { status: "externalUpdate"; version: string }
  | { status: "error"; message: string };

let _state: UpdaterStatus = { status: "idle" };
const _listeners = new Set<() => void>();

export function getUpdaterState(): UpdaterStatus {
  return _state;
}

export function onUpdaterStateChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function setState(next: UpdaterStatus) {
  _state = next;
  if (next.status === "error") console.error("[updater]", next.message);
  _listeners.forEach((fn) => fn());
}

/** Restart the app to apply the downloaded update. */
export async function installUpdate() {
  await invoke("updater_restart");
}

/** Manually trigger an update check. */
export async function checkForUpdate() {
  await invoke("updater_check");
}

/** Open the Voltius download page (used when this install can't self-update). */
export async function openDownloadPage() {
  await open("https://voltius.app/download");
}

/** Whether the background updater loop is allowed to run. */
export async function getAutoUpdate(): Promise<boolean> {
  return invoke<boolean>("updater_get_auto");
}

/** Enable/disable the background updater loop. */
export async function setAutoUpdate(enabled: boolean): Promise<void> {
  await invoke("updater_set_auto", { enabled });
}

/** Subscribe to backend updater events.  Call once at app startup. */
export function initUpdaterListener() {
  listen<UpdaterStatus>("updater-status", (event) => {
    setState(event.payload);
  }).catch(() => {});
}
