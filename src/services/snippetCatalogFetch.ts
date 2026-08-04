import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "./http";
import { parseCatalog, type CatalogEntry } from "./snippetCatalog";

export const CATALOG_URL = "https://raw.githubusercontent.com/voltiusApp/marketplace/main/snippets.json";

const CACHE_ID = "__meta__";
const CACHE_FILE = "snippet-catalog.json";

async function readCache(): Promise<string> {
  return invoke<string>("plugin_read_file", { id: CACHE_ID, filename: CACHE_FILE });
}

async function writeCache(content: string): Promise<void> {
  try {
    await invoke("plugin_write_file", { id: CACHE_ID, filename: CACHE_FILE, content });
  } catch {
    // A cache we cannot write is a slower next launch, not a failed fetch.
  }
}

export interface CatalogResult {
  entries: CatalogEntry[];
  fromCache: boolean;
}

/** Fetch the community catalogue, falling back to the last good copy so the tab
 *  still works offline and rides out the CDN lag after an upstream merge. */
export async function fetchCatalog(): Promise<CatalogResult> {
  try {
    const response = await appFetch(CATALOG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const entries = parseCatalog(text); // parse before caching, so a bad body never replaces a good cache
    await writeCache(text);
    return { entries, fromCache: false };
  } catch (networkError) {
    try {
      return { entries: parseCatalog(await readCache()), fromCache: true };
    } catch {
      throw networkError;
    }
  }
}
