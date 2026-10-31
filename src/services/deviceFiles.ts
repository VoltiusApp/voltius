import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { getAccountId } from "@/services/account";
import { getPlatform } from "@/utils/platform";
import {
  useDeviceFilesStore,
  type ActiveSession,
  type ApprovalPrompt,
  type FileAccessConfig,
  type FileAnswer,
} from "@/stores/deviceFilesStore";

const store = () => useDeviceFilesStore.getState();
const fail = (context: string) => logFailure(`device-files ${context}`);

let offs: Array<() => void> = [];
let starting: Promise<void> | null = null;
let generation = 0;
let lifecycle: Promise<unknown> = Promise.resolve();

// Start and stop must reach Rust in call order, or a late start revives a stopped service.
function inOrder(cmd: "device_files_start" | "device_files_stop", args?: Record<string, unknown>): Promise<void> {
  const run = lifecycle.then(() => invoke<void>(cmd, args));
  lifecycle = run.catch(() => {});
  return run;
}

async function refreshPending(): Promise<void> {
  store().setPending(await invoke<ApprovalPrompt[]>("device_files_pending"));
}

const refresh = () => refreshPending().catch(fail("pending"));

export async function loadFileAccess(): Promise<void> {
  if ((await getPlatform()) === "android") return;
  const accountId = await getAccountId();
  if (!accountId) return;
  const config = await invoke<FileAccessConfig>("device_files_get_config", { accountId });
  if (store().config === null) store().setConfig(config);
}

const startArgs = (accountId: string) => ({ accountId, notifyBody: i18n.t("layout.deviceFiles.title", { name: "{name}" }) });

async function begin(gen: number): Promise<void> {
  if ((await getPlatform()) === "android") return;
  const accountId = await getAccountId();
  if (!accountId || gen !== generation) return;
  await inOrder("device_files_start", startArgs(accountId));
  const attached: Array<() => void> = [];
  const detach = () => attached.splice(0).forEach((off) => off());
  const relabel = () => void inOrder("device_files_start", startArgs(accountId)).catch(fail("relabel"));
  try {
    i18n.on("languageChanged", relabel);
    attached.push(() => i18n.off("languageChanged", relabel));
    attached.push(await listen("device-files://request", () => void refresh()));
    attached.push(await listen<ActiveSession[]>("device-files://sessions", (e) => store().setSessions(e.payload)));
    attached.push(await listen<FileAccessConfig>("device-files://config", (e) => store().setConfig(e.payload)));
    window.addEventListener("focus", refresh);
    attached.push(() => window.removeEventListener("focus", refresh));
    const config = await invoke<FileAccessConfig>("device_files_get_config", { accountId });
    const pending = await invoke<ApprovalPrompt[]>("device_files_pending");
    if (gen !== generation) return detach();
    store().setConfig(config);
    store().setPending(pending);
    offs = attached;
  } catch (e) {
    detach();
    if (gen === generation) await inOrder("device_files_stop").catch(fail("stop"));
    throw e;
  }
}

export function startDeviceFiles(): Promise<void> {
  if (offs.length > 0) return Promise.resolve();
  if (!starting) {
    const p: Promise<void> = begin(generation).finally(() => {
      if (starting === p) starting = null;
    });
    starting = p;
  }
  return starting;
}

export async function stopDeviceFiles(): Promise<void> {
  generation++;
  starting = null;
  offs.forEach((off) => off());
  offs = [];
  store().reset();
  if ((await getPlatform()) === "android") return;
  await inOrder("device_files_stop").catch(fail("stop"));
}

export function connectDevice(deviceId: string, connectId: string, relink?: string): Promise<{ sftpId: string; rttMs: number; readOnly: boolean }> {
  return invoke("device_files_connect", { deviceId, connectId, relink });
}

export async function answerFileRequest(requestId: string, answer: FileAnswer): Promise<void> {
  try {
    await invoke("device_files_answer", { requestId, answer });
  } finally {
    await refresh();
  }
}

export async function saveFileAccess(config: FileAccessConfig): Promise<void> {
  const accountId = await getAccountId();
  if (!accountId) return;
  const prev = store().config;
  // Store first: a second save inside this round trip must build on this one, or Rust reads the dropped entry as a revoke.
  store().setConfig(config);
  try {
    await invoke("device_files_set_config", { accountId, config });
  } catch (e) {
    if (store().config === config) store().setConfig(prev);
    throw e;
  }
}

export function disconnectDevice(deviceKey: string): Promise<void> {
  return invoke("device_files_disconnect", { deviceKey });
}
