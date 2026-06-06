import { fsTarAvailable, sftpTarAvailable } from "@/services/sftp";
import { getToggle } from "@/stores/toggleSettingsStore";

// Cached per host ("local" or an sftpId); tar availability is stable per connection.
const probeCache = new Map<string, Promise<boolean>>();

function probe(key: string, fn: () => Promise<boolean>): Promise<boolean> {
  let p = probeCache.get(key);
  if (!p) {
    p = fn().catch(() => false);
    probeCache.set(key, p);
  }
  return p;
}

// True only if the toggle is on AND every involved host has `tar`; else callers
// fall back to plain SFTP. `involvesLocal` covers the local archiving step.
export async function tarUsable(
  sftpIds: Array<string | null | undefined>,
  involvesLocal: boolean,
): Promise<boolean> {
  if (!getToggle("sftp-tar")) return false;
  const checks: Promise<boolean>[] = [];
  if (involvesLocal) checks.push(probe("local", fsTarAvailable));
  for (const id of sftpIds) {
    if (id) checks.push(probe(id, () => sftpTarAvailable(id)));
  }
  return (await Promise.all(checks)).every(Boolean);
}
