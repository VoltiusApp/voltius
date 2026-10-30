import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  dropped: null as null | ((e: { payload: unknown }) => void),
  handlers: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  ctrl: null as null | Record<string, unknown>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => h.handlers[cmd]?.(args)),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    if (name === "android://files-dropped") h.dropped = cb;
    return () => { if (h.dropped === cb) h.dropped = null; };
  }),
}));
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
vi.mock("@/services/useSftpDir", async (orig) => ({
  ...(await orig<typeof import("@/services/useSftpDir")>()),
  useSftpDir: (target: unknown) => (target ? h.ctrl : { ...h.ctrl, phase: { tag: "connecting" }, sftpId: null }),
}));

import { invoke } from "@tauri-apps/api/core";
import { useAndroidFileDrop, FILE_DRAG_EVENT } from "./useAndroidFileDrop";
import type { SftpPaneId } from "./sftpSelectionCore";
import type { ContentFile } from "@/services/uploads";
import { useTransferQueueStore } from "@/stores/transferQueueStore";

const FILES: ContentFile[] = [{ uri: "content://f/1", name: "clip.mp4", size: 9 }];

let under: Element | null = null;
beforeEach(() => {
  under = null;
  document.elementFromPoint = () => under;
});
afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  useTransferQueueStore.setState({ transfers: [], pending: null });
});

const drag = (detail: { phase: "over"; x: number; y: number } | { phase: "leave" }) =>
  act(() => { window.dispatchEvent(new CustomEvent(FILE_DRAG_EVENT, { detail })); });
const drop = async () => {
  await vi.waitFor(() => expect(h.dropped).not.toBeNull());
  act(() => h.dropped!({ payload: { x: 5, y: 6, files: FILES } }));
};

function Harness({ enabled = true, fallback = "a", onDrop }: { enabled?: boolean; fallback?: SftpPaneId; onDrop: (p: SftpPaneId, f: ContentFile[]) => void }) {
  const hover = useAndroidFileDrop(enabled, fallback, onDrop);
  return (
    <div data-hover={hover ?? "none"}>
      <div data-sftp-pane="a"><span data-in="a" /></div>
      <div data-sftp-pane="b"><span data-in="b" /></div>
    </div>
  );
}

function mount(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const onDrop = vi.fn();
  const view = render(<Harness onDrop={onDrop} {...props} />);
  const hover = () => view.container.querySelector("[data-hover]")!.getAttribute("data-hover");
  const point = (id: string | null) => { under = id ? view.container.querySelector(`[data-in="${id}"]`) : null; };
  return { onDrop, hover, point };
}

describe("useAndroidFileDrop", () => {
  test("a drop goes to the pane under the finger", async () => {
    const { onDrop, point } = mount();
    point("b");
    await drop();
    expect(onDrop).toHaveBeenCalledWith("b", FILES);
  });

  test("a drop outside every pane goes to the active pane", async () => {
    const { onDrop, point } = mount({ fallback: "b" });
    point(null);
    await drop();
    expect(onDrop).toHaveBeenCalledWith("b", FILES);
  });

  test("the pane under the finger is highlighted until the drag leaves or drops", async () => {
    const { hover, point } = mount();
    point("b");
    drag({ phase: "over", x: 1, y: 2 });
    expect(hover()).toBe("b");
    point("a");
    drag({ phase: "over", x: 1, y: 3 });
    expect(hover()).toBe("a");
    drag({ phase: "leave" });
    expect(hover()).toBe("none");
    drag({ phase: "over", x: 1, y: 3 });
    await drop();
    expect(hover()).toBe("none");
  });

  test("does nothing while the screen is hidden", async () => {
    const { onDrop, hover, point } = mount({ enabled: false });
    point("a");
    drag({ phase: "over", x: 1, y: 2 });
    expect(hover()).toBe("none");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.dropped).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("MobileSftpScreen drop wiring", () => {
  test("a dropped file uploads into the active pane's folder", async () => {
    const refresh = vi.fn();
    h.ctrl = {
      phase: { tag: "connected" }, retrying: false, readOnly: false, sftpId: "s1", cwd: "/srv", entries: [], listing: false,
      landedCwd: "/srv", listError: null, listErrorCode: null, navigate: vi.fn(), goUp: vi.fn(), refresh, reconnect: vi.fn(),
      mkdir: vi.fn(), touch: vi.fn(), rename: vi.fn(), remove: vi.fn(),
    };
    h.handlers = {
      sftp_stat: () => null,
      upload_stage: (a) => `/cache/voltius-uploads/${a.transferId}/${a.name}`,
    };
    const { useConnectionStore } = await import("@/stores/connectionStore");
    useConnectionStore.setState({ connections: [{ id: "c1", name: "ssh-box", host: "h", port: 22, username: "u", vault_id: "personal" } as never] });
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    render(<MobileSftpScreen presetConnectionId="c1" />);
    await drop();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const uploads = vi.mocked(invoke).mock.calls.filter(([c]) => c === "sftp_upload").map(([, a]) => a as Record<string, unknown>);
    expect(uploads.map((a) => [a.sftpId, a.remotePath])).toEqual([["s1", "/srv/clip.mp4"]]);
  });
});
