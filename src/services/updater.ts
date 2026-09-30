import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type UpdaterStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "available"; version: string }
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

export function useUpdaterStatus(): UpdaterStatus {
  return useSyncExternalStore(onUpdaterStateChange, getUpdaterState);
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

/** Manually trigger an update check; downloads only when auto-download is on. */
export async function checkForUpdate() {
  await invoke("updater_check", { download: false });
}

export async function downloadUpdate() {
  await invoke("updater_check", { download: true });
}

/** Open the Voltius download page (used when this install can't self-update). */
export async function openDownloadPage() {
  await openUrl("https://voltius.app/download");
}

/** Whether updates download without asking; checks always run. */
export async function getAutoUpdate(): Promise<boolean> {
  return invoke<boolean>("updater_get_auto");
}

/** Enable/disable downloading updates without asking. */
export async function setAutoUpdate(enabled: boolean): Promise<void> {
  await invoke("updater_set_auto", { enabled });
}

/** Subscribe to backend updater events.  Call once at app startup. */
export function initUpdaterListener() {
  let heard = false;
  listen<UpdaterStatus>("updater-status", (event) => {
    heard = true;
    setState(event.payload);
  })
    .then(() => invoke<UpdaterStatus>("updater_get_state"))
    .then((seed) => { if (!heard) setState(seed); })
    .catch(() => {});
}
