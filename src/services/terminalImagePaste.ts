import i18n from "@/i18n";
import { describeError } from "@/services/backendErrors";
import {
  sftpCanonicalize, sftpClose, sftpDelete, sftpExists, sftpListDir, sftpMkdir, sftpOpen, sftpSetAttrs, sftpWriteBytes,
} from "@/services/sftp";
import { pasteToSession } from "@/services/terminalPaste";
import { useNotificationStore } from "@/stores/notificationStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { readClipboardImagePng } from "@/utils/clipboard";

/** Under the remote home: per-user, so no other account can pre-create or read it. */
export const PASTE_DIR_SEGMENTS = [".cache", "voltius", "pastes"];
const PASTE_PREFIX = "voltius-paste-";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function pastedImageName(at: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}-${p(at.getMilliseconds(), 3)}`;
  return `${PASTE_PREFIX}${stamp}.png`;
}

/** Single-quote `path` for a POSIX shell unless every character is already safe. */
export function shellQuotePath(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

async function ensurePasteDir(sftpId: string): Promise<string> {
  let dir = await sftpCanonicalize(sftpId, ".");
  for (const segment of PASTE_DIR_SEGMENTS) {
    dir = `${dir.replace(/\/$/, "")}/${segment}`;
    if (!(await sftpExists(sftpId, dir))) await sftpMkdir(sftpId, dir);
  }
  // Screenshots can hold anything on screen: keep them owner-only. Best effort, as
  // a host without a shell can't chmod; the home directory still guards them.
  await sftpSetAttrs(sftpId, { paths: [dir], set: 0, clear: 0o077 }).catch(() => {});
  return dir;
}

async function pruneOldPastes(sftpId: string, dir: string, nowSeconds: number): Promise<void> {
  const entries = await sftpListDir(sftpId, dir);
  const stale = entries.filter((f) =>
    !f.is_dir && f.name.startsWith(PASTE_PREFIX) && f.modified != null && nowSeconds - f.modified > MAX_AGE_SECONDS);
  for (const f of stale) await sftpDelete(sftpId, f.path).catch(() => {});
}

/** Upload `png` to the session's host over its own SSH connection; returns the remote path. */
export async function uploadPastedImage(sessionId: string, png: Uint8Array, now = new Date()): Promise<string> {
  const sftpId = await sftpOpen(sessionId);
  try {
    const dir = await ensurePasteDir(sftpId);
    const path = `${dir}/${pastedImageName(now)}`;
    await sftpWriteBytes(sftpId, path, png);
    await pruneOldPastes(sftpId, dir, Math.floor(now.getTime() / 1000)).catch(() => {});
    return path;
  } finally {
    await sftpClose(sftpId).catch(() => {});
  }
}

/**
 * Paste the clipboard image into an SSH session as a file path. A program on the
 * host (e.g. Claude Code) can't reach this machine's clipboard, so the image is
 * uploaded next to it and its path typed in, which such programs accept.
 */
export async function pasteClipboardImage(sessionId: string): Promise<void> {
  if (!getToggle("paste-image-as-path")) return;
  const png = await readClipboardImagePng();
  if (!png) return;
  try {
    const path = await uploadPastedImage(sessionId, png);
    await pasteToSession(sessionId, shellQuotePath(path));
  } catch (e) {
    useNotificationStore.getState().addToast({
      source: { kind: "plugin", id: "system", name: "Voltius" },
      type: "toast",
      severity: "error",
      message: i18n.t("terminal.pasteImage.failed", { error: describeError(e, i18n.t) }),
      duration: 8000,
    });
  }
}
