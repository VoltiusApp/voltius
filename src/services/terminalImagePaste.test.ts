import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  image: { id: 7, width: 1400, height: 860, size: 26316, thumbnail: "data:image/png;base64,AA==" } as object | null,
  uploads: [] as { args: Record<string, unknown>; resolve: (path: string) => void; reject: (e: unknown) => void }[],
  progress: new Map<string, (e: { payload: { transferred: number; total: number } }) => void>(),
  pasted: [] as string[],
  toggle: true,
  accepts: true,
  broadcast: false,
  noticeSeen: false,
  cancelled: [] as string[],
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: never) => {
    h.progress.set(event, cb);
    return () => h.progress.delete(event);
  }),
}));
vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn((cmd: string, args: Record<string, unknown>) => {
    if (cmd === "paste_image_read") return Promise.resolve(h.image);
    if (cmd === "paste_image_upload") return new Promise((resolve, reject) => h.uploads.push({ args, resolve, reject }));
    return Promise.reject(new Error(`unexpected ${cmd}`));
  }),
}));
vi.mock("@/services/sftp", () => ({
  sftpCancelTransfer: vi.fn(async (id: string) => { h.cancelled.push(id); }),
  sftpOpen: vi.fn(async () => "sftp-1"),
  sftpDelete: vi.fn(async () => {}),
  sftpClose: vi.fn(async () => {}),
}));
vi.mock("@/services/terminalPaste", () => ({ pasteToSession: vi.fn(async (_s: string, text: string) => { h.pasted.push(text); return true; }) }));
vi.mock("@/hooks/useTerminal", () => ({ sessionAcceptsInput: () => h.accepts }));
vi.mock("@/stores/layoutStore", () => ({ broadcastActiveForSession: () => h.broadcast }));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => h.toggle }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ sessions: [{ id: "s1", connectionName: "prod-api" }] }) } }));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ imagePasteNoticeSeen: h.noticeSeen, markImagePasteNoticeSeen: () => { h.noticeSeen = true; }, openSettings: vi.fn() }) },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) } }));
vi.mock("@/services/backendErrors", () => ({ describeError: (e: unknown) => (e as Error).message }));

import { pasteClipboardImage, shellQuotePath, SHOW_PROGRESS_AFTER_MS } from "./terminalImagePaste";
import { useNotificationStore } from "@/stores/notificationStore";

const toasts = () => useNotificationStore.getState().toasts;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(h, { uploads: [], pasted: [], cancelled: [], toggle: true, accepts: true, broadcast: false, noticeSeen: true });
  h.image = { id: 7, width: 1400, height: 860, size: 26316, thumbnail: "data:image/png;base64,AA==" };
  useNotificationStore.setState({ toasts: [], history: [] });
});
afterEach(() => vi.useRealTimers());

describe("shellQuotePath", () => {
  test("leaves a plain path bare and single-quotes the rest", () => {
    expect(shellQuotePath("/home/me/.cache/a-1.png")).toBe("/home/me/.cache/a-1.png");
    expect(shellQuotePath("/home/my user/it's.png")).toBe(`'/home/my user/it'\\''s.png'`);
  });
});

describe("pasteClipboardImage", () => {
  test("does nothing without an image, with the toggle off, or without input", async () => {
    h.image = null;
    await pasteClipboardImage("s1");
    h.image = { id: 1, width: 1, height: 1, size: 1, thumbnail: "" };
    h.toggle = false;
    await pasteClipboardImage("s1");
    h.toggle = true;
    h.accepts = false;
    await pasteClipboardImage("s1");
    expect(h.uploads).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  test("refuses while input is broadcast to several panes", async () => {
    h.broadcast = true;
    await pasteClipboardImage("s1");
    expect(h.uploads).toEqual([]);
    expect(toasts().map((t) => t.message)).toEqual(["terminal.pasteImage.broadcast"]);
  });

  test("a fast upload skips the progress toast and confirms with the path", async () => {
    const done = pasteClipboardImage("s1");
    await flush();
    h.uploads[0].resolve("/home/me/.cache/voltius/pastes/voltius-paste-1.png");
    await done;
    expect(h.pasted).toEqual(["/home/me/.cache/voltius/pastes/voltius-paste-1.png "]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({ finished: true, finishedSeverity: "success", message: "terminal.pasteImage.pasted" });
    expect(toasts()[0].action?.label).toBe("terminal.pasteImage.deleteFromHost");
  });

  test("a slow upload shows progress with Cancel", async () => {
    const done = pasteClipboardImage("s1");
    await flush();
    expect(toasts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(SHOW_PROGRESS_AFTER_MS);
    expect(toasts()[0]).toMatchObject({ message: "terminal.pasteImage.uploading", cancellable: true, progress: 0 });
    const transferId = h.uploads[0].args.transferId as string;
    h.progress.get(`sftp-progress-${transferId}`)!({ payload: { transferred: 50, total: 100 } });
    expect(toasts()[0].progress).toBe(50);

    toasts()[0].onCancel!();
    expect(h.cancelled).toEqual([transferId]);
    h.uploads[0].reject(new Error("cancelled"));
    await done;
    expect(toasts()[0].finishedSeverity).toBeUndefined();
    expect(h.pasted).toEqual([]);
  });

  test("the first paste explains where the image went", async () => {
    h.noticeSeen = false;
    const done = pasteClipboardImage("s1");
    await flush();
    h.uploads[0].resolve("/p/a.png");
    await done;
    expect(toasts()[0]).toMatchObject({ detail: "terminal.pasteImage.firstUse" });
    expect(toasts()[0].action?.label).toBe("terminal.pasteImage.settings");
    expect(h.noticeSeen).toBe(true);
  });

  test("a failure names the host, types nothing and retries the same image", async () => {
    const done = pasteClipboardImage("s1");
    await flush();
    h.uploads[0].reject(new Error("no write access"));
    await done;
    expect(h.pasted).toEqual([]);
    expect(toasts()[0]).toMatchObject({ finishedSeverity: "error", message: "terminal.pasteImage.failed", detail: "prod-api: no write access" });

    const toastId = toasts()[0].id;
    toasts()[0].action!.onClick();
    await flush();
    expect(h.uploads[1].args.imageId).toBe(7);
    expect(toasts()[0]).toMatchObject({ id: toastId, message: "terminal.pasteImage.uploading", finished: false });
    h.uploads[1].resolve("/p/b.png");
    await flush();
    expect(h.pasted).toEqual(["/p/b.png "]);
  });

  test("two quick pastes type their paths in paste order", async () => {
    const first = pasteClipboardImage("s1");
    const second = pasteClipboardImage("s1");
    await flush();
    expect(h.uploads).toHaveLength(1);
    h.uploads[0].resolve("/p/1.png");
    await flush();
    h.uploads[1].resolve("/p/2.png");
    await Promise.all([first, second]);
    expect(h.pasted).toEqual(["/p/1.png ", "/p/2.png "]);
  });
});
