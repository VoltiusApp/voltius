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

import { invoke } from "@tauri-apps/api/core";
import MobileSftpPane from "./MobileSftpPane";
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

function renderPane(ctrl = controller()) {
  const view = render(
    <MobileSftpPane controller={ctrl as never} connection={undefined}
      device={{ deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "windows", state: "ready", route: "lan", lastSeen: null } as never}
      selected={[]} onSelectionChange={() => {}} onPickHost={() => {}} onCopyToOther={() => {}} otherConnected={false}
      headerSlot={null} onScreen backUp={false} />,
  );
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

  test("cancelling while the file is copied skips the upload and removes the copy", async () => {
    let copied!: () => void;
    serve({
      upload_pick: () => [PICKED[0]],
      upload_stage: (a) => new Promise((r) => { copied = () => r(`/cache/voltius-uploads/${a.transferId}/a.jpg`); }),
    });
    const { ctrl, uploadItem } = renderPane();
    fireEvent.click(uploadItem()!);
    await vi.waitFor(() => expect(calls("upload_stage")).toHaveLength(1));
    const [{ transferId }] = calls("upload_stage");
    expect(useTransferQueueStore.getState().cancelTransfer(transferId as string)).toBe(true);
    copied();
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
