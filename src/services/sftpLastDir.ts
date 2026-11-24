import type { HostChoice } from "@/components/shared/HostPickerPanel";
import type { SftpDirTarget } from "@/services/useSftpDir";
import { sftpCanonicalize, sftpIsDir } from "@/services/sftp";

const STORAGE_KEY = "voltius.sftp.last_dir";

export const sftpDirKey = (target: SftpDirTarget) => ("device" in target ? target.device.deviceId : target.id);

export function hostDirTarget(host: Exclude<HostChoice, { kind: "local" }>): SftpDirTarget {
  return host.kind === "device" ? { device: host.device } : host.connection;
}

function readAll(): Record<string, string> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return all && typeof all === "object" ? (all as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function rememberSftpDir(key: string, dir: string): void {
  const all = readAll();
  if (all[key] === dir) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [key]: dir })); } catch {}
}

async function isDir(sftpId: string, path: string): Promise<boolean> {
  try { return await sftpIsDir(sftpId, path); } catch { return false; }
}

/** Where a fresh connection opens: the folder last listed on this host if it is still a directory, else home. */
export async function openingSftpDir(sftpId: string, key: string): Promise<{ home: string; cwd: string }> {
  const last = readAll()[key];
  const [home, lastOk] = await Promise.all([sftpCanonicalize(sftpId, "."), last ? isDir(sftpId, last) : false]);
  const resolvedHome = home || "/";
  return { home: resolvedHome, cwd: lastOk ? last! : resolvedHome };
}
