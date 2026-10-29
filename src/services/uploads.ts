import { invoke } from "@/lib/invoke";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { sftpExists, sftpUpload } from "@/services/sftp";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { queueAfterConflicts } from "@/components/filetransfer/osDropPipeline";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { useTransferQueueStore } from "@/stores/transferQueueStore";

/** A file the phone shared with us: a `content://` URI plus its display name and size. */
export interface ContentFile {
  uri: string;
  name: string;
  size: number;
}

/** Android's document picker (any type, several files); empty when cancelled. */
export function uploadPick(): Promise<ContentFile[]> {
  return withLeaveLockSuppressed(() => invoke<ContentFile[]>("upload_pick"));
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

/** Upload content URIs into `cwd`, one queued transfer each, copying each to a temp file first. */
export async function uploadContentFiles(files: ContentFile[], sftpId: string, cwd: string, onDone: () => void): Promise<void> {
  const items: FileEntry[] = files.map((f) => ({ name: f.name, path: f.uri, size: f.size, isDir: false }));
  await queueAfterConflicts(items, cwd, (p) => sftpExists(sftpId, p), async (chosen) => {
    const { runTransfer } = useTransferQueueStore.getState();
    for (const f of chosen) await runTransfer(f.name, "→", (tid) => uploadOne(f, sftpId, cwd, tid));
    onDone();
  });
}
