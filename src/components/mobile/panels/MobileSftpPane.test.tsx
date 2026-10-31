import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (args: Record<string, unknown>) => unknown>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => h.handlers[cmd]?.(args)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsAndroid: () => true,
  useIsIOS: () => false,
}));

import { createRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import MobileSftpPane, { type PaneDrop } from "./MobileSftpPane";
import { useTransferQueueStore } from "@/stores/transferQueueStore";

const CWD = "/home/u";
const PICKED = [
  { uri: "content://media/1", name: "a.jpg", size: 3 },
  { uri: "content://media/2", name: "b.txt", size: 4 },
];

function controller(over: Record<string, unknown> = {}) {
  return {
    phase: { tag: "connected" }, retrying: false, readOnly: false, sftpId: "s1", cwd: CWD, entries: [], listing: false,
    landedCwd: CWD, listError: null, listErrorCode: null, navigate: vi.fn(), goUp: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(),
    mkdir: vi.fn(), touch: vi.fn(), rename: vi.fn(), remove: vi.fn(),
    ...over,
  };
}

const WORK_PC = { deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "windows", state: "ready", route: "lan", lastSeen: null };
const SERVER = { id: "c1", name: "srv", host: "h", port: 22, username: "u" };

function mountPane(ctrl = controller(), dropHover = false, target: { device?: object; connection?: object } = { device: WORK_PC }) {
  const dropRef = createRef<PaneDrop>();
  const view = render(
    <MobileSftpPane controller={ctrl as never} connection={target.connection as never}
      device={target.device as never}
      selected={[]} onSelectionChange={() => {}} onPickHost={() => {}} onCopyToOther={() => {}} otherConnected={false}
      headerSlot={null} onScreen backUp={false} dropRef={dropRef} dropHover={dropHover} />,
  );
  return { view, ctrl, drop: (files = PICKED) => dropRef.current!(files) };
}

function renderPane(ctrl = controller()) {
  const { view } = mountPane(ctrl);
  fireEvent.click(view.container.querySelector("[data-sftp-create]")!);
  return { view, ctrl, uploadItem: () => document.querySelector<HTMLButtonElement>('[data-sftp-action="upload"]') };
}

const SETTLED = () => useTransferQueueStore.getState().transfers[0]?.settled;
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

function serve(over: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  h.handlers = {
    upload_pick: () => PICKED,
    sftp_stat: () => null,
    upload_stage: (a) => `/cache/voltius-uploads/${a.transferId}/${a.name}`,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  useTransferQueueStore.setState({ transfers: [], pending: null });
});

describe("MobileSftpPane upload", () => {
  test("upload_action_uploads_picked_files_to_cwd", async () => {
    serve();
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(ctrl.refresh).toHaveBeenCalledTimes(2));

    const staged = calls("upload_stage");
    expect(staged.map((a) => [a.uri, a.name])).toEqual([["content://media/1", "a.jpg"], ["content://media/2", "b.txt"]]);
    expect(calls("sftp_upload")).toEqual(staged.map((a) => ({
      sftpId: "s1", localPath: `/cache/voltius-uploads/${a.transferId}/${a.name}`,
      remotePath: `${CWD}/${a.name}`, transferId: a.transferId,
    })));
    expect(calls("upload_stage_clear").map((a) => a.transferId)).toEqual(staged.map((a) => a.transferId));
    expect(useTransferQueueStore.getState().transfers.map((t) => [t.label, t.direction, t.status]))
      .toEqual([["b.txt", "→", "done"], ["a.jpg", "→", "done"]]);
  });

  test("upload_cancel_does_nothing", async () => {
    serve({ upload_pick: () => [] });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(calls("upload_pick")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls("sftp_stat")).toEqual([]);
    expect(calls("upload_stage")).toEqual([]);
    expect(calls("sftp_upload")).toEqual([]);
    expect(useTransferQueueStore.getState().transfers).toEqual([]);
    expect(ctrl.refresh).not.toHaveBeenCalled();
  });

  test("upload_hidden_when_pane_disconnected", () => {
    const { uploadItem } = renderPane(controller({ phase: { tag: "connecting" }, sftpId: null }));
    expect(document.querySelector('[data-sftp-action="mobile.snippets.newfoldertitle"]')).not.toBeNull();
    expect(uploadItem()).toBeNull();
  });

  test("a failed upload still removes its temp copy", async () => {
    serve({ upload_pick: () => [PICKED[0]], sftp_upload: () => { throw new Error("disk full"); } });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(SETTLED()).toBe(true));
    const [staged] = calls("upload_stage");
    expect(calls("upload_stage_clear")).toEqual([{ transferId: staged.transferId }]);
    expect(useTransferQueueStore.getState().transfers[0].status).toBe("error");
    expect(ctrl.refresh).not.toHaveBeenCalled();
  });

  test("cancelling while the file is copied stops the copy and removes it", async () => {
    let stopCopy!: () => void;
    serve({
      upload_pick: () => [PICKED[0]],
      upload_stage: () => new Promise((_, reject) => { stopCopy = () => reject(new Error("Transfer cancelled")); }),
    });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(calls("upload_stage")).toHaveLength(1));
    const [{ transferId }] = calls("upload_stage");
    expect(useTransferQueueStore.getState().cancelTransfer(transferId as string)).toBe(true);
    expect(calls("sftp_cancel_transfer")).toEqual([{ transferId }]);
    stopCopy();
    await vi.waitFor(() => expect(SETTLED()).toBe(true));
    expect(ctrl.refresh).not.toHaveBeenCalled();
    expect(calls("sftp_upload")).toEqual([]);
    expect(calls("upload_stage_clear")).toEqual([{ transferId }]);
    expect(useTransferQueueStore.getState().transfers[0].status).toBe("cancelled");
  });

  test("retry copies the file again from its URI and refreshes the listing", async () => {
    let fails = 1;
    serve({
      upload_pick: () => [PICKED[0]],
      sftp_upload: () => { if (fails-- > 0) throw new Error("connection lost"); },
    });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(SETTLED()).toBe(true));
    const first = useTransferQueueStore.getState().transfers[0];
    expect(first.status).toBe("error");

    useTransferQueueStore.getState().retryTransfer(first.id);
    await vi.waitFor(() => expect(ctrl.refresh).toHaveBeenCalledTimes(1));
    const staged = calls("upload_stage");
    expect(staged.map((a) => a.uri)).toEqual(["content://media/1", "content://media/1"]);
    expect(staged[1].transferId).not.toBe(staged[0].transferId);
    expect(calls("upload_stage_clear").map((a) => a.transferId)).toEqual(staged.map((a) => a.transferId));
    expect(calls("sftp_upload")[1].localPath).toBe(`/cache/voltius-uploads/${staged[1].transferId}/a.jpg`);
  });

  test("a hostile display name cannot climb out of the folder", async () => {
    serve({ upload_pick: () => [{ uri: "content://x/1", name: "../../.bashrc", size: 1 }, { uri: "content://x/2", name: "..", size: 1 }] });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(ctrl.refresh).toHaveBeenCalledTimes(2));
    expect(calls("sftp_upload").map((a) => a.remotePath)).toEqual([`${CWD}/.._.._.bashrc`, `${CWD}/file`]);
  });

  test("a name clash asks first, as the desktop upload does", async () => {
    serve({ sftp_stat: (a) => (a.path === `${CWD}/a.jpg` ? { size: 1 } : null) });
    const { uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(useTransferQueueStore.getState().pending).not.toBeNull());
    const pending = useTransferQueueStore.getState().pending!;
    expect(pending.conflicts.map((f) => f.name)).toEqual(["a.jpg"]);
    expect(pending.toTransfer.map((f) => f.name)).toEqual(["b.txt"]);
    expect(calls("upload_stage")).toEqual([]);
  });
});

describe("MobileSftpPane drop from another app", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("a drop uploads the files into the pane's folder, like the menu row", async () => {
    serve();
    const { ctrl, drop } = mountPane();
    drop();
    await vi.waitFor(() => expect(ctrl.refresh).toHaveBeenCalledTimes(2));
    expect(calls("upload_pick")).toEqual([]);
    expect(calls("upload_stage").map((a) => a.uri)).toEqual(["content://media/1", "content://media/2"]);
    expect(calls("sftp_upload").map((a) => [a.sftpId, a.remotePath])).toEqual([["s1", `${CWD}/a.jpg`], ["s1", `${CWD}/b.txt`]]);
  });

  test("a drop on a disconnected pane does nothing", async () => {
    serve();
    const { drop } = mountPane(controller({ phase: { tag: "connecting" }, sftpId: null }));
    drop();
    await settle();
    expect([...calls("sftp_stat"), ...calls("upload_stage"), ...calls("sftp_upload")]).toEqual([]);
  });

  test("a drop on a read-only device is refused and uploads nothing", async () => {
    serve();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { drop } = mountPane(controller({ readOnly: true }));
    drop();
    await settle();
    expect(alert).toHaveBeenCalledWith("fileTransfer.myDevices.readOnlyShare");
    expect([...calls("sftp_stat"), ...calls("upload_stage"), ...calls("sftp_upload")]).toEqual([]);
    alert.mockRestore();
  });

  test("the hovered pane is highlighted only when it can take the files", () => {
    const overlay = () => document.body.textContent?.includes("fileTransfer.pane.dropToTransfer");
    mountPane(controller(), true);
    expect(overlay()).toBe(true);
    cleanup();
    mountPane(controller(), false);
    expect(overlay()).toBe(false);
    cleanup();
    mountPane(controller({ readOnly: true }), true);
    expect(overlay()).toBe(false);
    cleanup();
    mountPane(controller({ phase: { tag: "connecting" }, sftpId: null }), true);
    expect(overlay()).toBe(false);
  });
});

describe("MobileSftpPane permissions", () => {
  const script = { name: "a.sh", path: `${CWD}/a.sh`, size: 1, isDir: false, permissions: 0o755 };
  const permissionsOffered = (target: { device?: object; connection?: object }) => {
    mountPane(controller({ entries: [script] }), false, target);
    fireEvent.click(document.querySelector(`[data-sftp-row-actions="${script.path}"]`)!);
    const offered = document.body.textContent?.includes("fileTransfer.pane.menu.permissions");
    cleanup();
    return offered;
  };

  test("a device pane does not offer permissions, an ssh pane does", () => {
    expect(permissionsOffered({ device: WORK_PC })).toBe(false);
    expect(permissionsOffered({ connection: SERVER })).toBe(true);
  });
});
