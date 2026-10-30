import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  confirm: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}:${Object.values(o).join(",")}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/services/lanSync", () => ({
  openPairing: h.open,
  closePairing: h.close,
  confirmPairing: h.confirm,
  cancelPairing: h.cancel,
}));

import { PairDeviceBody } from "./PairDeviceBody";
import { IDLE_PAIRING, useLanSyncStore, type Pairing } from "@/stores/lanSyncStore";

const onClose = vi.fn();
const set = (p: Pairing) => act(() => useLanSyncStore.getState().setPairing(p));
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = () => document.body.textContent ?? "";

beforeEach(() => useLanSyncStore.setState({ pairing: { state: "searching" } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useLanSyncStore.setState({ pairing: IDLE_PAIRING });
});

describe("PairDeviceBody", () => {
  test("opens the pairing window on mount and closes it on every unmount", () => {
    const { unmount } = render(<PairDeviceBody onClose={onClose} />);
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.close).not.toHaveBeenCalled();
    unmount();
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  test("searching explains what to do on the other device and the signed-in case", () => {
    render(<PairDeviceBody onClose={onClose} />);
    expect(text()).toContain("layout.sync.local.pair.searching");
    expect(text()).toContain("layout.sync.local.pair.signedInHint");
  });

  test("the code shows as 123 456 in tabular digits and Codes match confirms", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 123456, role: "host", peerName: "Pixel" });
    const code = q("[data-pair-code]")!;
    expect(code.textContent).toBe("123 456");
    expect(code.className).toContain("tabular-nums");
    expect(text()).toContain("layout.sync.local.pair.compare");
    expect(q("[data-pair-action='combine']")).toBeNull();
    fireEvent.click(q("[data-pair-action='confirm']")!);
    expect(h.confirm).toHaveBeenCalledWith();
  });

  test.each(["host", "joiner"] as const)("the %s sees which member a new key replaces before Codes match", (role) => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 1, role, peerName: "Kitchen PC" });
    expect(q("[data-pair-replaces]")).toBeNull();
    set({ state: "code", sas: 1, role, peerName: "Kitchen PC", replaces: "Old laptop" });
    const warning = q("[data-pair-replaces]")!;
    expect(warning.textContent).toBe("layout.sync.local.pair.replaces:Old laptop");
    expect(warning.compareDocumentPosition(q("[data-pair-action='confirm']")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    set({ state: "peerConfirmed", sas: 1, role, peerName: "Kitchen PC", replaces: "Old laptop" });
    expect(q("[data-pair-replaces]")).not.toBeNull();
  });

  test("a small code is zero padded", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 42, role: "host", peerName: "Pixel" });
    expect(q("[data-pair-code]")!.textContent).toBe("000 042");
  });

  test("a joiner with data picks Combine both (default focus) or the host's data", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 123456, role: "joiner", peerName: "Desk", peerHasData: true });
    expect(q("[data-pair-action='confirm']")).toBeNull();
    expect(document.activeElement).toBe(q("[data-pair-action='combine']"));
    expect(q("[data-pair-action='theirs']")!.textContent).toBe("layout.sync.local.pair.useTheirs:Desk");
    fireEvent.click(q("[data-pair-action='theirs']")!);
    expect(h.confirm).toHaveBeenCalledWith("replace");
    fireEvent.click(q("[data-pair-action='combine']")!);
    expect(h.confirm).toHaveBeenLastCalledWith("combine");
  });

  test("an empty joiner gets the plain confirm", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 1, role: "joiner", peerName: "Desk", peerHasData: false });
    expect(q("[data-pair-action='confirm']")).not.toBeNull();
    expect(q("[data-pair-action='combine']")).toBeNull();
  });

  test("peer confirmed names the peer and still waits for this side", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "peerConfirmed", sas: 123456, role: "host", peerName: "Pixel" });
    expect(text()).toContain("layout.sync.local.pair.peerConfirmed:Pixel");
    expect(q("[data-pair-action='confirm']")).not.toBeNull();
  });

  test("Cancel cancels the code and keeps the sheet open", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "code", sas: 1, role: "host", peerName: "P" });
    fireEvent.click(q("[data-pair-action='cancel']")!);
    expect(h.cancel).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Cancel shows while waiting for the peer and goes once the grant arrived", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "joining", role: "joiner", peerName: "P" });
    expect(q("[data-pair-action='cancel']")).not.toBeNull();
    set({ state: "joining", role: "joiner", peerName: "P", granted: true });
    expect(text()).toContain("layout.sync.local.pair.joining");
    expect(q("[data-pair-action='cancel']")).toBeNull();
  });

  test("done says who it paired with and closes", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "done", peerName: "Pixel" });
    expect(text()).toContain("layout.sync.local.pair.done:Pixel");
    fireEvent.click(q("[data-pair-action='close']")!);
    expect(onClose).toHaveBeenCalled();
  });

  test.each(["accountDevice", "bothGrouped", "alreadyPaired", "timedOut", "cancelled", "busy", "tooManyAttempts", "failed", "stopped"])(
    "ended %s shows its copy",
    (reason) => {
      render(<PairDeviceBody onClose={onClose} />);
      set({ state: "ended", reason });
      expect(q("[data-pair-reason]")!.textContent).toBe(`errors.pair.ended.${reason}`);
    },
  );

  test("an unknown reason falls back to failed", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "ended", reason: "mismatch" });
    expect(q("[data-pair-reason]")!.textContent).toBe("errors.pair.ended.failed");
  });

  test("an ended pairing with the window still open shows the reason and keeps searching", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "ended", reason: "busy" });
    expect(text()).toContain("layout.sync.local.pair.searching");
    expect(q("[data-pair-action='retry']")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a closed window offers Close and Try again, which reopens", () => {
    render(<PairDeviceBody onClose={onClose} />);
    set({ state: "ended", reason: "timedOut", closed: true });
    expect(text()).not.toContain("layout.sync.local.pair.searching");
    fireEvent.click(q("[data-pair-action='retry']")!);
    expect(h.open).toHaveBeenCalledTimes(2);
    fireEvent.click(q("[data-pair-action='close']")!);
    expect(onClose).toHaveBeenCalled();
  });

  test("no upgrade link in any pairing state with checkout unavailable", () => {
    render(<PairDeviceBody onClose={onClose} />);
    const states: Pairing[] = [
      { state: "searching" },
      { state: "code", sas: 1, role: "joiner", peerName: "D", peerHasData: true },
      { state: "joining", peerName: "D" },
      { state: "done", peerName: "D" },
      { state: "ended", reason: "bothGrouped", closed: true },
    ];
    for (const p of states) {
      set(p);
      expect(text()).not.toMatch(/upgrade|upsell/i);
    }
  });
});
