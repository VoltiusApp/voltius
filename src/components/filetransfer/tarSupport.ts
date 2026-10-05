import { sftpTarAvailable } from "@/services/sftp";
import { getToggle } from "@/stores/toggleSettingsStore";

export type TarMode = "tar" | "perFile" | "off";
export type Accel = Exclude<TarMode, "off">;

// The backend caches each host's answer and re-asks after a failed probe or a reconnect.
const probe = (sftpId: string) => sftpTarAvailable(sftpId).catch(() => false);

export async function tarMode(sftpIds: Array<string | null | undefined>): Promise<TarMode> {
  const ids = sftpIds.filter((id): id is string => !!id);
  if (!getToggle("sftp-tar") || ids.length === 0) return "off";
  const ok = await Promise.all(ids.map(probe));
  return ok.every(Boolean) ? "tar" : "perFile";
}

export interface TarEndpoint { isLocal: boolean; sftpId?: string | null }

// local↔local never tars: `fsCopy` already does the whole copy in one native call.
export function tarModeForPair(src: TarEndpoint, dst: TarEndpoint): Promise<TarMode> {
  if (src.isLocal && dst.isLocal) return Promise.resolve("off");
  return tarMode([src.sftpId, dst.sftpId]);
}

export function accelFor(mode: TarMode, isDir: boolean): Accel | undefined {
  return isDir && mode !== "off" ? mode : undefined;
}
