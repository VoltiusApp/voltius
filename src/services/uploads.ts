import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { sftpExists, sftpUpload } from "@/services/sftp";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { queueAfterConflicts } from "@/components/filetransfer/osDropPipeline";
import { isPlainName } from "@/components/filetransfer/remoteName";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { useTransferQueueStore } from "@/stores/transferQueueStore";

export interface ContentFile {
  uri: string;
  name: string;
  size: number;
}

export function uploadPick(): Promise<ContentFile[]> {
  return withLeaveLockSuppressed(() => invoke<ContentFile[]>("upload_pick"));
}

// Same rule as Rust `scratch::safe_file_name`, which guards the local copy; this one guards the remote path.
function safeUploadName(name: string): string {
  const flat = name.replace(/[/\\\0]/g, "_");
  return isPlainName(flat.trim(), false) ? flat : "file";
}

const isCancelled = (tid: string) =>
  useTransferQueueStore.getState().transfers.find((t) => t.id === tid)?.status === "cancelled";

async function uploadOne(f: FileEntry, sftpId: string, cwd: string, tid: string): Promise<void> {
  try {
    const tmp = await invoke<string>("upload_stage", { uri: f.path, name: f.name, transferId: tid });
    // Cancel can only reach sftp_upload once it runs, so one pressed during the copy is checked here.
    if (isCancelled(tid)) throw new Error("cancelled");
    await sftpUpload({ sftpId, localPath: tmp, remotePath: joinPath(cwd, f.name), transferId: tid });
  } finally {
    await invoke("upload_stage_clear", { transferId: tid }).catch(() => {});
  }
}

async function uploadEach(files: FileEntry[], sftpId: string, cwd: string, onDone: () => void): Promise<void> {
  const { runTransfer } = useTransferQueueStore.getState();
  for (const f of files) await runTransfer(f.name, "→", (tid) => uploadOne(f, sftpId, cwd, tid), onDone);
}

export async function uploadContentFiles(files: ContentFile[], sftpId: string, cwd: string, onDone: () => void): Promise<void> {
  const items: FileEntry[] = files.map((f) => ({ name: safeUploadName(f.name), path: f.uri, size: f.size, isDir: false }));
  await queueAfterConflicts(items, cwd, (p) => sftpExists(sftpId, p),
    (chosen) => void uploadEach(chosen, sftpId, cwd, onDone).catch(logFailure("upload")));
}
