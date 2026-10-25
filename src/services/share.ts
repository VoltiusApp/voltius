import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { snippetScriptText } from "@/services/snippetSteps";
import type { Snippet } from "@/types";
import { getPlatformSync } from "@/utils/platform";

/**
 * Outgoing Android share sheet. The native side (ShareSheet.kt, `window.VoltiusShare`) builds
 * an ACTION_SEND / ACTION_SEND_MULTIPLE intent and opens the system chooser. Files go through
 * the app FileProvider with a read grant, and only from the share staging folders under the
 * app cache (`voltius-downloads/share-*`, see `shareStageId`); the native side refuses any
 * other path and prunes old staged files. On iOS, text goes through the Web Share API of
 * WKWebView (files are not offered there yet). Everywhere else (desktop, web, tests)
 * `canShare()` is false and nothing is offered.
 *
 * What gets shared is decided here, by pure helpers, so it is unit-tested: a key's OpenSSH
 * public line only (never the private half), a snippet's command text, remote files.
 */

type Bridge = {
  shareText(text: string, title: string): boolean;
  shareFiles(pathsJson: string, mime: string, title: string): boolean;
};
type ShareWindow = Window & { VoltiusShare?: Bridge };

const bridge = (): Bridge | undefined =>
  typeof window === "undefined" ? undefined : (window as ShareWindow).VoltiusShare;

/** The Web Share API, on iOS only (desktop WebKit has it too, but desktop shares nothing). */
const webShare = (): ((data: ShareData) => Promise<void>) | undefined =>
  typeof navigator !== "undefined" && typeof navigator.share === "function" && getPlatformSync() === "ios"
    ? (data) => navigator.share(data)
    : undefined;

/** True where a system share sheet can be opened (the Android shell, iOS for text). */
export function canShare(): boolean {
  return !!bridge() || !!webShare();
}

/** Text larger than this would overflow the Binder transaction that carries the intent. */
export const MAX_SHARE_TEXT = 100_000;
/** Remote files bigger than this (in total) ask before they are downloaded for sharing. */
export const SHARE_CONFIRM_BYTES = 50 * 1024 * 1024;
/** How long the leave-lock waits at most for the user to come back from the chooser. */
const RETURN_WAIT_MS = 5 * 60_000;

/** Transfer id of a file downloaded for sharing: the native side only shares from these folders. */
export const shareStageId = (transferId: string) => `share-${transferId}`;

const PUBLIC_KEY_LINE =
  /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[ \t]+[A-Za-z0-9+/]+={0,2}([ \t][^\r\n]*)?$/;

/**
 * The text to share for a key: its single OpenSSH public line ("type base64 [comment]"), or
 * null. Anything that is not exactly one such line is refused, so a private key (PEM or
 * OpenSSH armour, multi-line, "PRIVATE KEY") can never come out of here whatever was stored.
 */
export function publicKeyShareText(stored: string | null | undefined): string | null {
  const v = stored?.trim();
  if (!v || /[\r\n]/.test(v) || /PRIVATE KEY/i.test(v)) return null;
  return PUBLIC_KEY_LINE.test(v) ? v : null;
}

/** The text to share for a snippet: its script steps, or null when it has none (transfer-only). */
export function snippetShareText(snippet: Pick<Snippet, "steps">): string | null {
  const text = snippetScriptText(snippet);
  return text.trim() ? text : null;
}

/** The entries of a selection that can be shared as files (folders cannot). */
export function shareableFiles<T extends { isDir: boolean }>(items: T[]): T[] {
  return items.filter((f) => !f.isDir);
}

export function shareTotalBytes(items: { size: number }[]): number {
  return items.reduce((n, f) => n + (f.size > 0 ? f.size : 0), 0);
}

const TEXT_EXTS = ["txt", "log", "yml", "yaml", "conf", "cfg", "ini", "env", "sh", "py", "rs", "js", "ts", "toml"];
const MIME_BY_EXT: Record<string, string> = {
  ...Object.fromEntries(TEXT_EXTS.map((e) => [e, "text/plain"])),
  md: "text/markdown", csv: "text/csv", json: "application/json", xml: "text/xml", html: "text/html", htm: "text/html",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip", tgz: "application/gzip", tar: "application/x-tar",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
};

/** MIME type of one file name; unknown → application/octet-stream. */
export function mimeForName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

/** One MIME type covering every file: the common type, else `<top>/*`, else `*` + `/*`. */
export function shareMime(names: string[]): string {
  const types = [...new Set(names.map(mimeForName))];
  if (types.length === 1) return types[0];
  const tops = [...new Set(types.map((m) => m.split("/")[0]))];
  return tops.length === 1 ? `${tops[0]}/*` : "*/*";
}

/**
 * Keeps the "lock when leaving" setting from locking the vault behind the chooser and the app
 * the user shares to: suppressed until the page is visible again after having been hidden.
 */
function untilBack(): Promise<void> {
  return new Promise((done) => {
    let left = false;
    const onVis = () => {
      if (document.visibilityState === "hidden") left = true;
      else if (left) finish();
    };
    const finish = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      done();
    };
    const timer = setTimeout(finish, RETURN_WAIT_MS);
    document.addEventListener("visibilitychange", onVis);
  });
}

function open(call: (b: Bridge) => boolean): boolean {
  const b = bridge();
  if (!b) return false;
  let ok = false;
  try {
    ok = call(b) === true;
  } catch {
    return false;
  }
  if (ok) void withLeaveLockSuppressed(untilBack);
  return ok;
}

/** Open the share sheet for plain text. False if it could not be opened. */
export function shareText(text: string, title = ""): boolean {
  if (!text || text.length > MAX_SHARE_TEXT) return false;
  const web = !bridge() ? webShare() : undefined;
  if (web) {
    // Must run inside the tap (user activation). A dismissed sheet rejects: nothing to report.
    void withLeaveLockSuppressed(untilBack);
    web({ text, title: title || undefined }).catch(() => {});
    return true;
  }
  return open((b) => b.shareText(text, title));
}

/** Open the share sheet for staged files (absolute paths from `downloadTempPath(shareStageId(..))`). */
export function shareFiles(paths: string[], names: string[], title = ""): boolean {
  if (paths.length === 0) return false;
  return open((b) => b.shareFiles(JSON.stringify(paths), shareMime(names), title));
}
