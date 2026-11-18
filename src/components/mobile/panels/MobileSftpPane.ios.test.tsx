// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (args: unknown, opts?: { headers?: Record<string, string> }) => unknown>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: unknown, opts?: { headers?: Record<string, string> }) => h.handlers[cmd]?.(args, opts)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  getPlatformSync: () => "ios",
  useIsAndroid: () => false,
  useIsIOS: () => true,
  useIsMobile: () => true,
}));

import { createRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import MobileSftpPane, { type PaneDrop } from "./MobileSftpPane";
import { useFileDrop } from "./useFileDrop";
import { useTransferQueueStore } from "@/stores/transferQueueStore";

const CWD = "/home/u";
const MB = 1024 * 1024;

function controller() {
  return {
    phase: { tag: "connected" }, retrying: false, readOnly: false, sftpId: "s1", cwd: CWD, entries: [], listing: false,
    landedCwd: CWD, listError: null, listErrorCode: null, navigate: vi.fn(), goUp: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(),
    mkdir: vi.fn(), touch: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  };
}

function openUpload() {
  const ctrl = controller();
  const view = render(
    <MobileSftpPane controller={ctrl as never} connection={undefined as never} device={{ deviceId: "d1", deviceKey: "k", name: "PC", platform: "windows", state: "ready", route: "lan", lastSeen: null } as never}
      selected={[]} onSelectionChange={() => {}} onPickHost={() => {}} onCopyToOther={() => {}} otherConnected={false}
      headerSlot={null} onScreen backUp={false} dropRef={createRef<PaneDrop>()} dropHover={false} />,
  );
  fireEvent.click(view.container.querySelector("[data-sftp-create]")!);
  fireEvent.click(document.querySelector('[data-sftp-action="upload"]')!);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { ctrl, input };
}

function choose(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files });
  fireEvent.change(input);
}

const chunkCalls = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "upload_stage_chunk")
  .map(([, body, opts]) => {
    const { headers } = opts as { headers: Record<string, string> };
    return { id: headers["transfer-id"], offset: headers.offset, bytes: (body as Uint8Array).length };
  });
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

function serve() {
  h.handlers = {
    sftp_stat: () => null,
    upload_stage_chunk: (_b, opts) => `/cache/voltius-uploads/${opts!.headers!["transfer-id"]}/upload`,
  };
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('input[type="file"]').forEach((i) => i.remove());
  vi.mocked(invoke).mockClear();
  useTransferQueueStore.setState({ transfers: [], pending: null });
});

describe("iOS upload", () => {
  test("files chosen in the WebView picker are staged in 4 MB chunks and uploaded to the folder", async () => {
    serve();
    const { ctrl, input } = openUpload();
    expect(input.multiple).toBe(true);
    choose(input, [new File([new Uint8Array(9 * MB)], "big.iso"), new File([], "empty.txt")]);
    await vi.waitFor(() => expect(ctrl.refresh).toHaveBeenCalledTimes(2));

    const chunks = chunkCalls();
    const [big, empty] = [...new Set(chunks.map((c) => c.id))];
    expect(chunks.map((c) => [c.id, c.offset, c.bytes])).toEqual([
      [big, "0", 4 * MB], [big, String(4 * MB), 4 * MB], [big, String(8 * MB), MB],
      [empty, "0", 0],
    ]);
    expect(calls("sftp_upload").map((a) => [a.localPath, a.remotePath])).toEqual([
      [`/cache/voltius-uploads/${big}/upload`, `${CWD}/big.iso`],
      [`/cache/voltius-uploads/${empty}/upload`, `${CWD}/empty.txt`],
    ]);
    expect(calls("upload_stage")).toEqual([]);
    expect(calls("upload_pick")).toEqual([]);
    expect(calls("upload_stage_clear").map((a) => a.transferId)).toEqual([big, empty]);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  test("closing the picker without a choice uploads nothing", async () => {
    serve();
    const { input } = openUpload();
    fireEvent(input, new Event("cancel"));
    await new Promise((r) => setTimeout(r, 0));
    expect(chunkCalls()).toEqual([]);
    expect(useTransferQueueStore.getState().transfers).toEqual([]);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

function DropHarness({ onDrop }: { onDrop: (pane: string, files: unknown[]) => void }) {
  const hover = useFileDrop("webview", "a", onDrop);
  return <div data-hover={hover ?? "none"}><div data-sftp-pane="b"><span data-in="b" /></div></div>;
}

function dragEvent(type: string, files: File[]) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files } });
  Object.defineProperty(e, "clientX", { value: 3 });
  Object.defineProperty(e, "clientY", { value: 4 });
  return e;
}

describe("iOS drop", () => {
  test("files dragged in from another app highlight the pane under the finger and land there", () => {
    const onDrop = vi.fn();
    const view = render(<DropHarness onDrop={onDrop} />);
    document.elementFromPoint = () => view.container.querySelector('[data-in="b"]');
    const over = dragEvent("dragover", []);
    act(() => { window.dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(true);
    expect(view.container.querySelector("[data-hover]")!.getAttribute("data-hover")).toBe("b");

    const file = new File(["hi"], "note.txt");
    const drop = dragEvent("drop", [file]);
    act(() => { window.dispatchEvent(drop); });
    expect(drop.defaultPrevented).toBe(true);
    expect(onDrop).toHaveBeenCalledWith("b", [{ uri: expect.stringMatching(/^webview-file:/), name: "note.txt", size: 2 }]);
    expect(view.container.querySelector("[data-hover]")!.getAttribute("data-hover")).toBe("none");
  });

  test("a drag without files is left to the page", () => {
    const onDrop = vi.fn();
    render(<DropHarness onDrop={onDrop} />);
    const e = new Event("dragover", { cancelable: true }) as DragEvent;
    Object.defineProperty(e, "dataTransfer", { value: { types: ["text/plain"], files: [] } });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
  });
});
