import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConnectRetry } from "./useConnectRetry";
import { FAST_DELAYS_MS, connectRetryDelay } from "@/stores/reconnectBackoffCore";

type Phase = { tag: string; message?: string; errorCode?: "vault-locked" };

describe("connectRetryDelay", () => {
  it("follows the fast schedule for transient failures, then stops", () => {
    expect(connectRetryDelay(0, "SSH connection failed: Connection refused")).toBe(FAST_DELAYS_MS[0]);
    expect(connectRetryDelay(3, "SSH connection failed: Connection refused")).toBe(FAST_DELAYS_MS[3]);
    expect(connectRetryDelay(FAST_DELAYS_MS.length, "SSH connection failed: Connection refused")).toBeNull();
  });

  // Retrying these gets the host banned by fail2ban, or can never succeed.
  it("never retries what a retry cannot fix", () => {
    expect(connectRetryDelay(0, "Password authentication rejected — check the username and password.")).toBeNull();
    expect(connectRetryDelay(0, "FTP login failed: 530 Login incorrect")).toBeNull();
    expect(connectRetryDelay(0, "WARNING: Host key changed for h:22!\nStored   : a")).toBeNull();
    expect(connectRetryDelay(0, "Connection aborted by user.")).toBeNull();
    expect(connectRetryDelay(0, "Vault is locked", "vault-locked")).toBeNull();
  });
});

describe("useConnectRetry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = (initial: Phase) => {
    const retry = vi.fn();
    const hook = renderHook(({ phase }: { phase: Phase }) => useConnectRetry(phase, retry), { initialProps: { phase: initial } });
    return { retry, hook };
  };
  const fail = (): Phase => ({ tag: "error", message: "SSH connection failed: Connection refused" });

  it("retries a transient failure with a growing delay", () => {
    const { retry, hook } = setup(fail());
    expect(hook.result.current.retrying).toBe(true);
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);

    hook.rerender({ phase: { tag: "connecting" } });
    hook.rerender({ phase: fail() });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[1] - FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("gives up once the schedule is spent and leaves the error up", () => {
    const { retry, hook } = setup(fail());
    for (let i = 0; i < FAST_DELAYS_MS.length; i++) {
      act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[i]); });
      hook.rerender({ phase: { tag: "connecting" } });
      hook.rerender({ phase: fail() });
    }
    expect(retry).toHaveBeenCalledTimes(FAST_DELAYS_MS.length);
    expect(hook.result.current.retrying).toBe(false);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(retry).toHaveBeenCalledTimes(FAST_DELAYS_MS.length);
  });

  it("does not retry rejected credentials or a locked vault", () => {
    for (const phase of [
      { tag: "error", message: "Public key authentication rejected." },
      { tag: "error", message: "locked", errorCode: "vault-locked" as const },
    ]) {
      const { retry, hook } = setup(phase);
      expect(hook.result.current.retrying).toBe(false);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(retry).not.toHaveBeenCalled();
      hook.unmount();
    }
  });

  it("starts a fresh schedule after connecting", () => {
    const { retry, hook } = setup(fail());
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    hook.rerender({ phase: { tag: "connected" } });
    hook.rerender({ phase: fail() });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
