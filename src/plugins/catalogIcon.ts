import { isHostIconPrefix } from "@/utils/hostIconPrefixes";

// A catalogue entry's icon comes from a remote source, and Iconify fetches an
// unknown prefix over the network — so only prefixes the host bundles are used.
export function catalogIcon(icon: string | undefined, fallback: string): string {
  if (typeof icon !== "string") return fallback;
  const [prefix, ...rest] = icon.split(":");
  const name = rest.join(":");
  if (!prefix || !name || !isHostIconPrefix(prefix)) return fallback;
  return icon;
}
