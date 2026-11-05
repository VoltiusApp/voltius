import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { notify } from "@/services/saveFile";
import { clientVersion } from "@/services/clientHeaders";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";
import { SETTING_KEYS, domainOf, relPath } from "@/services/user-data/settingKeys";
import { getPath, setPath } from "@/utils/dotPath";
import { rememberServer, storedServerUrl } from "@/utils/serverInstance";
import { isEnforcedLock, isLocked } from "@/stores/policyStore";

type CliChange = { id: string; kind: string } & Record<string, unknown>;
interface Settled {
  id: string;
  error: string | null;
}

const LOCKED = "locked by policy";
const SERVER_LOCK_KEY = "server.url";

export function settingPatch(key: string, value: unknown): { domain: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  setPath(data, relPath(key), value);
  return { domain: domainOf(key), data };
}

async function applySetting(key: string, value: unknown): Promise<string | null> {
  if (isEnforcedLock(key)) return LOCKED;
  const { domain, data } = settingPatch(key, value);
  const handler = USER_DATA_HANDLERS.find((h) => h.key === domain);
  if (!handler) return `unknown setting ${key}`;
  await handler.import(data);
  return null;
}

function applyServer(url: string): string | null {
  if (isLocked(SERVER_LOCK_KEY)) return LOCKED;
  rememberServer(url);
  return null;
}

async function applyChange(c: CliChange): Promise<Settled | null> {
  try {
    if (c.kind === "setting") return { id: c.id, error: await applySetting(c.key as string, c.value) };
    if (c.kind === "server") return { id: c.id, error: applyServer(c.url as string) };
  } catch (e) {
    return { id: c.id, error: e instanceof Error ? e.message : String(e) };
  }
  return null;
}

let running: Promise<void> | null = null;

async function runPending(): Promise<void> {
  let changes: CliChange[];
  try {
    changes = ((await invoke("cli_pending_load")) as { changes: CliChange[] }).changes;
  } catch (e) {
    console.warn("[cli] pending changes unreadable:", e);
    return;
  }
  const results: Settled[] = [];
  for (const change of changes) {
    const settled = await applyChange(change);
    if (settled) results.push(settled);
  }
  if (!results.length) return;
  await invoke("cli_pending_settle", { results });
  const failed = results.filter((r) => r.error !== null).length;
  if (failed) notify("error", i18n.t("common.cliPending.failed", { count: failed }));
}

export function applyCliPending(): Promise<void> {
  running ??= runPending()
    .catch((e) => console.warn("[cli] applying pending changes failed:", e))
    .then(writeCliMirror)
    .finally(() => {
      running = null;
    });
  return running;
}

export async function writeCliMirror(): Promise<void> {
  try {
    const exported = new Map(USER_DATA_HANDLERS.map((h) => [h.key, h.export()]));
    const settings = Object.fromEntries(
      SETTING_KEYS.map(({ id }) => [id, getPath(exported.get(domainOf(id)), relPath(id)) ?? null]),
    );
    const mirror = {
      writtenAt: new Date().toISOString(),
      appVersion: (await clientVersion()) ?? "",
      settings,
      serverUrl: storedServerUrl() || null,
      plugins: [],
    };
    await invoke("cli_mirror_save", { mirror });
  } catch (e) {
    console.warn("[cli] mirror write failed:", e);
  }
}
