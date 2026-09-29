import { getVersion } from "@tauri-apps/api/app";

export const RULE_SETS_FEATURE = "rule-sets";

let versionPromise: Promise<string | null> | null = null;

export function clientVersion(): Promise<string | null> {
  versionPromise ??= getVersion().catch(() => {
    versionPromise = null;
    return null;
  });
  return versionPromise;
}

// Compatibility signals only, never authorization: the server refuses every team route to clients without them.
export async function clientHeaders(): Promise<Record<string, string>> {
  const version = await clientVersion();
  return {
    "X-Client-Features": RULE_SETS_FEATURE,
    ...(version !== null ? { "X-Client-Version": version } : {}),
  };
}
