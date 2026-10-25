// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canShare, canShareFiles, mimeForName, publicKeyShareText, shareFiles, shareMime, shareStageId, shareTotalBytes,
  shareableFiles, shareText, snippetShareText, MAX_SHARE_TEXT,
} from "./share";
import { isLeaveLockSuppressed } from "./leaveLockSuppression";

const platform = vi.hoisted(() => ({ os: null as string | null }));
const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/lib/invoke", () => ({ invoke }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  getPlatformSync: () => platform.os,
}));

const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk3m1Qq7oHqH2k1lR3n8d0Zr5fXy6V2eJt0c5o4p9Ws demo@voltius";
const PRIVATE = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

type W = Window & { VoltiusShare?: unknown };
afterEach(() => {
  delete (window as W).VoltiusShare;
  platform.os = null;
  vi.unstubAllGlobals();
});

function installBridge() {
  const b = { shareText: vi.fn(() => true), shareFiles: vi.fn(() => true) };
  (window as W).VoltiusShare = b;
  return b;
}

describe("publicKeyShareText", () => {
  it("shares the OpenSSH public line as is", () => {
    expect(publicKeyShareText(`  ${ED}\n`)).toBe(ED);
    expect(publicKeyShareText("ecdsa-sha2-nistp256 AAAAE2VjZHNh")).toBe("ecdsa-sha2-nistp256 AAAAE2VjZHNh");
  });
  it("never lets a private key through", () => {
    expect(publicKeyShareText(PRIVATE)).toBeNull();
    expect(publicKeyShareText("-----BEGIN RSA PRIVATE KEY-----")).toBeNull();
    expect(publicKeyShareText(`${ED}\n${PRIVATE}`)).toBeNull();
    expect(publicKeyShareText(`ssh-ed25519 AAAA PRIVATE KEY`)).toBeNull();
  });
  it("refuses anything that is not one public key line", () => {
    expect(publicKeyShareText(null)).toBeNull();
    expect(publicKeyShareText("")).toBeNull();
    expect(publicKeyShareText("hello world")).toBeNull();
    expect(publicKeyShareText(`${ED}\n${ED}`)).toBeNull();
  });
});

describe("snippetShareText", () => {
  it("shares the script steps joined by newlines", () => {
    expect(snippetShareText({ steps: [{ kind: "script", content: "cd /srv" }, { kind: "script", content: "ls -la" }] })).toBe("cd /srv\nls -la");
  });
  it("leaves transfer and nested steps out, and is null with no script", () => {
    const transfer = { kind: "transfer", from: "local", to: "remote", from_path: "a", to_path: "b", is_dir: false, mode: "auto", on_conflict: "skip" } as never;
    expect(snippetShareText({ steps: [transfer, { kind: "script", content: "uptime" }] })).toBe("uptime");
    expect(snippetShareText({ steps: [transfer, { kind: "snippet", snippet_id: "x" }] })).toBeNull();
    expect(snippetShareText({ steps: [{ kind: "script", content: "  \n" }] })).toBeNull();
  });
});

describe("files", () => {
  it("keeps files, drops folders, sums sizes", () => {
    const items = [{ name: "a.txt", isDir: false, size: 10 }, { name: "d", isDir: true, size: 4096 }, { name: "b.png", isDir: false, size: 5 }];
    expect(shareableFiles(items).map((f) => f.name)).toEqual(["a.txt", "b.png"]);
    expect(shareTotalBytes(shareableFiles(items))).toBe(15);
  });
  it("picks one MIME type for the set", () => {
    expect(mimeForName("report.PDF")).toBe("application/pdf");
    expect(mimeForName("Makefile")).toBe("application/octet-stream");
    expect(mimeForName(".bashrc")).toBe("application/octet-stream");
    expect(shareMime(["notes.txt"])).toBe("text/plain");
    expect(shareMime(["a.png", "b.jpg"])).toBe("image/*");
    expect(shareMime(["a.png", "b.pdf"])).toBe("*/*");
  });
  it("stages under share-<id>", () => {
    expect(shareStageId("t1")).toBe("share-t1");
  });
});

describe("bridge", () => {
  it("is not offered without the native bridge (desktop)", () => {
    expect(canShare()).toBe(false);
    expect(shareText("x")).toBe(false);
    expect(shareFiles(["/c/a"], ["a"])).toBe(false);
  });
  it("hands text and files to the bridge", () => {
    const b = installBridge();
    expect(canShare()).toBe(true);
    expect(shareText("uptime", "Uptime")).toBe(true);
    expect(b.shareText).toHaveBeenCalledWith("uptime", "Uptime");
    expect(shareFiles(["/cache/voltius-downloads/share-t1/a.png", "/cache/voltius-downloads/share-t2/b.jpg"], ["a.png", "b.jpg"])).toBe(true);
    expect(b.shareFiles).toHaveBeenCalledWith(JSON.stringify(["/cache/voltius-downloads/share-t1/a.png", "/cache/voltius-downloads/share-t2/b.jpg"]), "image/*", "");
  });
  it("refuses empty or oversized text", () => {
    const b = installBridge();
    expect(shareText("")).toBe(false);
    expect(shareText("x".repeat(MAX_SHARE_TEXT + 1))).toBe(false);
    expect(b.shareText).not.toHaveBeenCalled();
  });
  it("suppresses the leave-lock until the page comes back", () => {
    installBridge();
    const vis = vi.spyOn(document, "visibilityState", "get");
    expect(shareText("uptime")).toBe(true);
    expect(isLeaveLockSuppressed()).toBe(true);
    vis.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isLeaveLockSuppressed()).toBe(true);
    vis.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    vis.mockRestore();
    return Promise.resolve().then(() => Promise.resolve()).then(() => expect(isLeaveLockSuppressed()).toBe(false));
  });
});

describe("iOS web share", () => {
  it("shares text through navigator.share on iOS", () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, share });
    platform.os = "ios";
    expect(canShare()).toBe(true);
    expect(shareText(ED, "key")).toBe(true);
    expect(share).toHaveBeenCalledWith({ text: ED, title: "key" });
  });
  it("offers nothing on desktop even where WebKit has navigator.share", () => {
    vi.stubGlobal("navigator", { ...navigator, share: vi.fn() });
    platform.os = "macos";
    expect(canShare()).toBe(false);
    expect(shareText(ED)).toBe(false);
  });
  it("prefers the Android bridge when it is there", () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, share });
    platform.os = "ios";
    const b = installBridge();
    expect(shareText(ED, "t")).toBe(true);
    expect(b.shareText).toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });
});

describe("shareFiles on iOS", () => {
  it("opens the native share sheet with the staged paths", () => {
    platform.os = "ios";
    expect(canShareFiles()).toBe(true);
    const paths = ["/cache/voltius-downloads/share-t1/a.png"];
    expect(shareFiles(paths, ["a.png"])).toBe(true);
    expect(invoke).toHaveBeenCalledWith("share_files_native", { paths });
    expect(isLeaveLockSuppressed()).toBe(true);
  });

  it("offers nothing on desktop", () => {
    platform.os = "linux";
    expect(canShareFiles()).toBe(false);
    expect(shareFiles(["/tmp/a"], ["a"])).toBe(false);
  });
});
