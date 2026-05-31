import type { PluginAPI } from "@/plugins/api";
import type { ImageUpdateStatus } from "./types";

// ─── Plugin API singleton ───────────────────────────────────────────────────
// The Docker right-panel section is registered as a bare component, so it can't
// receive `api` via props. We capture it at register() time instead.

let pluginApi: PluginAPI | null = null;

export function initDockerRuntime(api: PluginAPI): void {
  pluginApi = api;
}

export function getDockerApi(): PluginAPI | null {
  return pluginApi;
}

// ─── Update-check settings ──────────────────────────────────────────────────

export interface DockerUpdateSettings {
  /** Run update checks automatically when the Images view is opened. */
  autoCheck: boolean;
  /** Cache TTL — minimum hours between automatic re-checks of the same image. */
  intervalHours: number;
  /** After pulling an update, recreate the containers using that image. */
  recreateAfterPull: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: DockerUpdateSettings = {
  autoCheck: false,
  intervalHours: 12,
  recreateAfterPull: true,
};

// Settings are declared in the manifest's `contributes.configuration` and written
// by the host's settings form; we only read them here.
export async function getUpdateSettings(): Promise<DockerUpdateSettings> {
  if (!pluginApi) return DEFAULT_UPDATE_SETTINGS;
  const autoCheck =
    (await pluginApi.storage.get<boolean>("autoCheck")) ?? DEFAULT_UPDATE_SETTINGS.autoCheck;
  const intervalHours =
    (await pluginApi.storage.get<number>("intervalHours")) ?? DEFAULT_UPDATE_SETTINGS.intervalHours;
  const recreateAfterPull =
    (await pluginApi.storage.get<boolean>("recreateAfterPull")) ??
    DEFAULT_UPDATE_SETTINGS.recreateAfterPull;
  return { autoCheck, intervalHours, recreateAfterPull };
}

// ─── Result cache ───────────────────────────────────────────────────────────
// Throttles registry round-trips (Docker Hub anonymous = 100 pulls / 6h / IP).
// Kept in memory as the source of truth and debounce-flushed to plugin storage,
// which avoids the read-modify-write races of many concurrent checks.

interface CacheEntry {
  status: ImageUpdateStatus;
  checkedAt: number;
}
type CacheMap = Record<string, CacheEntry>;

const CACHE_KEY = "updateCache";

let memCache: CacheMap | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function cacheKey(scope: string, image: string): string {
  return `${scope}::${image}`;
}

async function ensureCache(): Promise<CacheMap> {
  if (memCache) return memCache;
  memCache = (pluginApi ? await pluginApi.storage.get<CacheMap>(CACHE_KEY) : null) ?? {};
  return memCache;
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    if (pluginApi && memCache) pluginApi.storage.set(CACHE_KEY, memCache).catch(() => {});
  }, 500);
}

export async function getCachedStatus(
  scope: string,
  image: string,
  ttlMs: number,
): Promise<ImageUpdateStatus | null> {
  const cache = await ensureCache();
  const entry = cache[cacheKey(scope, image)];
  if (!entry || Date.now() - entry.checkedAt > ttlMs) return null;
  return entry.status;
}

export async function setCachedStatus(
  scope: string,
  image: string,
  status: ImageUpdateStatus,
): Promise<void> {
  const cache = await ensureCache();
  cache[cacheKey(scope, image)] = { status, checkedAt: Date.now() };
  scheduleFlush();
}
