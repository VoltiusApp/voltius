import { fsTarAvailable, sftpTarAvailable } from "@/services/sftp";
import { getToggle } from "@/stores/toggleSettingsStore";

// Cached per host ("local" or an sftpId); availability doesn't change within a
// connection, so each host is probed at most once.
const probeCache = new Map<string, Promise<boolean>>();

function probe(key: string, fn: () => Promise<boolean>): Promise<boolean> {
  let p = probeCache.get(key);
  if (!p) {
    p = fn().catch(() => false);
    probeCache.set(key, p);
  }
  return p;
}

/**
 * Whether a tar-accelerated transfer can run: the toggle is on AND every host
 * the archiving touches has `tar`. When false, callers fall back to plain SFTP.
 * `sftpIds` are the remote endpoints (nulls ignored); `involvesLocal` is true
 * when either endpoint is the local machine, which does the local archiving.
 */
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
