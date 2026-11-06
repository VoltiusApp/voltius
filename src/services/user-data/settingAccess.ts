import { getPath, setPath } from "@/utils/dotPath";
import { USER_DATA_HANDLERS } from "./registry";
import { domainOf, relPath } from "./settingKeys";

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

export function settingPatch(key: string, value: unknown): { domain: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  setPath(data, relPath(key), value);
  return { domain: domainOf(key), data };
}

export function readSetting(key: string): unknown {
  const handler = USER_DATA_HANDLERS.find((h) => h.key === domainOf(key));
  return handler ? getPath(handler.export(), relPath(key)) : undefined;
}

export function importSetting(key: string, value: unknown): Promise<void> | null {
  const { domain, data } = settingPatch(key, value);
  return USER_DATA_HANDLERS.find((h) => h.key === domain)?.import(data) ?? null;
}
