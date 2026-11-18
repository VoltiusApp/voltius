import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { notify } from "@/services/saveFile";
import { clientVersion } from "@/services/clientHeaders";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";
import { SETTING_KEYS, domainOf, relPath } from "@/services/user-data/settingKeys";
import { importSetting, readSetting, sameValue } from "@/services/user-data/settingAccess";
import { normalizeGlobalProxy } from "@/services/user-data/handlers/appSettings";
import { effectiveBuiltIn } from "@/services/policy/adminDefaults";
import { getPath } from "@/utils/dotPath";
import { sanitizeKeywordRules } from "@/utils/keywordMatcher";
import { rememberServer, storedServerUrl } from "@/utils/serverInstance";
import { useAdminDefaultsStore } from "@/stores/adminDefaultsStore";
import { touchAppSetting } from "@/stores/appSettingsTimestampStore";
import { LOCKED, isEnforcedLock, isLocked } from "@/stores/policyStore";
import type { CliPluginAction } from "./cliPlugins";

type CliChange = { id: string; kind: string } & Record<string, unknown>;
interface Settled {
  id: string;
  error: string | null;
}

const cliPlugins = () => import("./cliPlugins");
const cliSyncMirror = () => import("./cliSyncMirror");
const INVALID = "invalid value";
const UNKNOWN = "unknown setting";
// Retrying cannot fix these, so the entry is dropped after one toast.
const TERMINAL: ReadonlySet<string> = new Set([INVALID, UNKNOWN]);
const SERVER_LOCK_KEY = "server.url";

const NORMALISED: Record<string, (v: unknown) => unknown> = {
  "appSettings.terminal.keywordRules": (v) => (Array.isArray(v) ? sanitizeKeywordRules(v) : v),
  "appSettings.proxy": (v) => normalizeGlobalProxy(v) ?? v,
};
const asStored = (key: string, value: unknown): unknown => NORMALISED[key]?.(value) ?? value;

let ready = false;

export function markCliReady(): void {
  if (ready) return;
  ready = true;
  cliSyncMirror()
    .then((m) => m.watchSyncForCli(writeCliMirror))
    .catch((e) => console.warn("[cli] sync mirror watch failed:", e));
}

export async function applySetting(key: string, value: unknown): Promise<string | null> {
  if (isEnforcedLock(key)) return LOCKED;
  const pending = importSetting(key, value);
  if (!pending) return UNKNOWN;
  await pending;
  if (!sameValue(readSetting(key), asStored(key, value))) return INVALID;
  if (domainOf(key) === "appSettings") touchAppSetting(key);
  else useAdminDefaultsStore.getState().clear(key);
  return null;
}

function applyServer(url: string): string | null {
  if (isLocked(SERVER_LOCK_KEY)) return LOCKED;
  return rememberServer(url) ? null : INVALID;
}

async function applyChange(c: CliChange): Promise<Settled | null> {
  try {
    if (c.kind === "setting") return { id: c.id, error: await applySetting(c.key as string, c.value) };
    if (c.kind === "server") return { id: c.id, error: applyServer(c.url as string) };
    if (c.kind === "plugin") {
      const change = {
        action: c.action as CliPluginAction,
        id: c.pluginId as string,
        consentedPermissions: (c.consentedPermissions as string[] | undefined) ?? [],
      };
      return { id: c.id, error: await (await cliPlugins()).applyPluginChange(change) };
    }
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
  if (changes.some((c) => c.kind === "plugin")) await (await cliPlugins()).pluginInstallPolicyIdle();
  const results: Settled[] = [];
  let failed = 0;
  for (const change of changes) {
    const settled = await applyChange(change);
    if (!settled) continue;
    const { error } = settled;
    if (error !== null && error !== change.error) failed++;
    results.push(error !== null && TERMINAL.has(error) ? { id: settled.id, error: null } : settled);
  }
  if (!results.length) return;
  await invoke("cli_pending_settle", { results });
  if (failed) notify("error", i18n.t("common.cliPending.failed", { count: failed }));
}

export function applyCliPending(): Promise<void> {
  if (!ready) return Promise.resolve();
  running ??= runPending()
    .catch((e) => console.warn("[cli] applying pending changes failed:", e))
    .then(writeCliMirror)
    .finally(() => {
      running = null;
    });
  return running;
}

export async function writeCliMirror(): Promise<void> {
  if (!ready) return;
  try {
    const domains = new Set(SETTING_KEYS.map((k) => domainOf(k.id)));
    const exported = new Map(USER_DATA_HANDLERS.filter((h) => domains.has(h.key)).map((h) => [h.key, h.export()]));
    const builtIns = Object.fromEntries(SETTING_KEYS.map(({ id }) => [id, effectiveBuiltIn(id) ?? null]));
    const settings = Object.fromEntries(
      SETTING_KEYS.map(({ id }) => [id, getPath(exported.get(domainOf(id)), relPath(id)) ?? builtIns[id]]),
    );
    const mirror = {
      writtenAt: new Date().toISOString(),
      appVersion: (await clientVersion()) ?? "",
      settings,
      builtIns,
      serverUrl: storedServerUrl() || null,
      plugins: await (await cliPlugins()).mirrorPlugins(),
      sync: await cliSyncMirror().then((m) => m.syncMirror()).catch(() => null),
    };
    await invoke("cli_mirror_save", { mirror });
  } catch (e) {
    console.warn("[cli] mirror write failed:", e);
  }
}
