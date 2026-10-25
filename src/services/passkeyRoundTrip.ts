import { openUrl } from "@tauri-apps/plugin-opener";
import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { getPlatform, isMobilePlatform } from "@/utils/platform";

/** Where the browser sends the code: a listener on this machine, or the app's own link on a phone. */
export type PasskeyReturn = { kind: "loopback"; port: number; state: string } | { kind: "app"; state: string };
export type OpenPasskey = (returnTo: PasskeyReturn) => Promise<{ url: string }>;

export class PasskeyCancelledError extends Error {
  constructor() {
    super("passkey cancelled");
    this.name = "PasskeyCancelledError";
  }
}

const WAIT_MS = 5 * 60_000;
const CODE_RE = /^[A-Za-z0-9_-]{16,128}$/;

interface Listener {
  returnTo: PasskeyReturn;
  code: Promise<string>;
  stop: () => void;
}

let awaitedLink: { state: string; deliver: (code: string) => void } | null = null;
let cancelCurrent: (() => void) | null = null;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function listenOnLoopback(state: string): Promise<Listener> {
  const port = await invoke<number>("passkey_loopback_start", {
    state,
    title: i18n.t("layout.twoFactor.passkeyDoneTitle"),
    message: i18n.t("layout.twoFactor.passkeyDoneBody"),
  });
  return {
    returnTo: { kind: "loopback", port, state },
    code: invoke<string>("passkey_loopback_wait"),
    stop: () => void invoke("passkey_loopback_stop").catch(() => {}),
  };
}

function listenForLink(state: string): Listener {
  let fail: (reason: Error) => void = () => {};
  const code = new Promise<string>((resolve, reject) => {
    awaitedLink = { state, deliver: resolve };
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error("timed out")), WAIT_MS);
  return {
    returnTo: { kind: "app", state },
    code,
    stop: () => {
      clearTimeout(timer);
      awaitedLink = null;
      fail(new Error("stopped"));
    },
  };
}

/**
 * Claims a `voltius://passkey` link. It answers a ceremony this app opened, so it
 * never joins the deep-link queue, and one that matches nothing waiting is dropped.
 */
export function acceptPasskeyReturn(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "voltius:" || parsed.hostname !== "passkey") return false;
  const code = parsed.searchParams.get("c") ?? "";
  if (awaitedLink && parsed.searchParams.get("s") === awaitedLink.state && CODE_RE.test(code)) {
    awaitedLink.deliver(code);
  }
  return true;
}

export function cancelPasskeyRoundTrip(): void {
  cancelCurrent?.();
}

/** Runs a passkey ceremony in the system browser and resolves with the code it hands back. */
export async function passkeyRoundTrip(open: OpenPasskey): Promise<string> {
  cancelCurrent?.();
  const listener = isMobilePlatform(await getPlatform()) ? listenForLink(randomState()) : await listenOnLoopback(randomState());
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    listener.stop();
  };
  cancelCurrent = cancel;
  const code = listener.code.catch(() => {
    throw cancelled ? new PasskeyCancelledError() : new Error(i18n.t("common.error.passkeyIncomplete"));
  });
  code.catch(() => {});
  try {
    const { url } = await open(listener.returnTo);
    await openUrl(url);
    return await code;
  } finally {
    listener.stop();
    if (cancelCurrent === cancel) cancelCurrent = null;
  }
}
