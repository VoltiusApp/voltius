import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

import { tmuxFailure, tmuxInstall, tmuxPinVersion, tmuxStatus, type TmuxHostStatus } from "./tmuxInstall";

const STATUS: TmuxHostStatus = { supported: true, system: null, active: "3.8", copies: [{ version: "3.8", sessions: 0 }], outdated: false, systemControlCapable: false };

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
});

describe("tmuxInstall", () => {
  test("listens before it starts, reports progress, then unlistens", async () => {
    const order: string[] = [];
    let emit: (e: { payload: unknown }) => void = () => {};
    const unlisten = vi.fn();
    listen.mockImplementation(async (_event: string, h: typeof emit) => {
      order.push("listen");
      emit = h;
      return unlisten;
    });
    invoke.mockImplementation(async () => {
      order.push("invoke");
      emit({ payload: { step: "verify", progress: 85 } });
      return STATUS;
    });
    const seen: unknown[] = [];
    const { promise } = tmuxInstall("s1", (p) => seen.push(p));
    await expect(promise).resolves.toEqual(STATUS);
    expect(order).toEqual(["listen", "invoke"]);
    const { installId } = invoke.mock.calls[0][1];
    expect(invoke.mock.calls[0]).toEqual(["ssh_tmux_install", { sessionId: "s1", installId }]);
    expect(listen.mock.calls[0][0]).toBe(`tmux-install-${installId}`);
    expect(seen).toEqual([{ step: "verify", progress: 85 }]);
    expect(unlisten).toHaveBeenCalled();
  });

  test("cancel names the same install, and a failure still unlistens", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_tmux_install") throw "cancelled";
    });
    const { promise, cancel } = tmuxInstall("s1", () => {});
    cancel();
    await expect(promise).rejects.toBe("cancelled");
    const cancelCall = invoke.mock.calls.find(([cmd]) => cmd === "ssh_tmux_cancel");
    const installCall = invoke.mock.calls.find(([cmd]) => cmd === "ssh_tmux_install");
    expect(cancelCall?.[1].installId).toBe(installCall?.[1].installId);
    expect(unlisten).toHaveBeenCalled();
  });
});

test("tmuxStatus asks the session", async () => {
  invoke.mockResolvedValue(STATUS);
  await expect(tmuxStatus("s9")).resolves.toEqual(STATUS);
  expect(invoke).toHaveBeenCalledWith("ssh_tmux_status", { sessionId: "s9" });
});

test("the pin version is fetched once, and again after a failure", async () => {
  invoke.mockRejectedValueOnce("boom").mockResolvedValue("3.8");
  await expect(tmuxPinVersion()).rejects.toBe("boom");
  await expect(tmuxPinVersion()).resolves.toBe("3.8");
  await expect(tmuxPinVersion()).resolves.toBe("3.8");
  expect(invoke.mock.calls.filter(([cmd]) => cmd === "ssh_tmux_pin_version")).toHaveLength(2);
});

test("install rejections map to a failure kind", () => {
  for (const kind of ["download", "checksum", "unsupported", "inside", "newer", "cancelled"] as const) {
    expect(tmuxFailure(kind)).toBe(kind);
  }
  expect(tmuxFailure("no-sha256")).toBe("other");
  expect(tmuxFailure(new Error("newer"))).toBe("other");
});
