import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { sftpExists, sftpUpload } from "@/services/sftp";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { queueAfterConflicts } from "@/components/filetransfer/osDropPipeline";
import { isPlainName } from "@/components/filetransfer/remoteName";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { getPlatformSync } from "@/utils/platform";

export interface ContentFile {
  uri: string;
  name: string;
  size: number;
}

const CHUNK_BYTES = 4 * 1024 * 1024;
// Files the WebView holds (iOS picker, drops), keyed by the `uri` their ContentFile carries.
const webviewFiles = new Map<string, File>();
let webviewSeq = 0;

export function fromWebviewFiles(files: Iterable<File>): ContentFile[] {
  return [...files].map((file) => {
    const uri = `webview-file:${++webviewSeq}`;
    webviewFiles.set(uri, file);
    return { uri, name: file.name, size: file.size };
  });
}

// WKWebView's file input opens the iOS picker (Files, Photos, camera); Android has its own.
function pickInWebview(): Promise<ContentFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    const done = (files: ContentFile[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(fromWebviewFiles(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    document.body.append(input);
    input.click();
  });
}

export function uploadPick(): Promise<ContentFile[]> {
  return withLeaveLockSuppressed(() =>
    getPlatformSync() === "ios" ? pickInWebview() : invoke<ContentFile[]>("upload_pick"));
}

async function stageWebviewFile(file: File, tid: string): Promise<string> {
  let path = "";
  let offset = 0;
  do {
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    path = await invoke<string>("upload_stage_chunk", bytes, { headers: { "transfer-id": tid, offset: String(offset) } });
    offset += CHUNK_BYTES;
  } while (offset < file.size);
  return path;
}

// Same rule as Rust `scratch::safe_file_name`, which guards the local copy; this one guards the remote path.
function safeUploadName(name: string): string {
  const flat = name.replace(/[/\\\0]/g, "_");
  return isPlainName(flat.trim(), false) ? flat : "file";
}

async function uploadOne(f: FileEntry, sftpId: string, cwd: string, tid: string, held?: File): Promise<void> {
  try {
    const tmp = held
      ? await stageWebviewFile(held, tid)
      : await invoke<string>("upload_stage", { uri: f.path, name: f.name, transferId: tid });
    await sftpUpload({ sftpId, localPath: tmp, remotePath: joinPath(cwd, f.name), transferId: tid });
  } finally {
    await invoke("upload_stage_clear", { transferId: tid }).catch(() => {});
  }
}

async function uploadEach(files: FileEntry[], sftpId: string, cwd: string, onDone: () => void): Promise<void> {
  const { runTransfer } = useTransferQueueStore.getState();
  await Promise.all(files.map((f) => {
    // The queue owns the selected file, including while waiting or retrying.
    let held = webviewFiles.get(f.path);
    webviewFiles.delete(f.path);
    return runTransfer(f.name, "→", async (tid) => {
      await uploadOne(f, sftpId, cwd, tid, held);
      held = undefined;
    }, onDone);
  }));
}

export async function uploadContentFiles(files: ContentFile[], sftpId: string, cwd: string, onDone: () => void): Promise<void> {
  const items: FileEntry[] = files.map((f) => ({ name: safeUploadName(f.name), path: f.uri, size: f.size, isDir: false }));
  await queueAfterConflicts(items, cwd, (p) => sftpExists(sftpId, p), (chosen) => {
    for (const f of files) if (!chosen.some((c) => c.path === f.uri)) webviewFiles.delete(f.uri);
    void uploadEach(chosen, sftpId, cwd, onDone).catch(logFailure("upload"));
  });
}
