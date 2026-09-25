import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConnectRetry } from "./useConnectRetry";
import { FAST_DELAYS_MS, SLOW_RETRY_MS, STABLE_CONNECTION_MS, connectRetryDelay } from "@/stores/reconnectBackoffCore";

type Phase = { tag: string; message?: string; errorCode?: "vault-locked" };

describe("connectRetryDelay", () => {
  it("follows the fast schedule for transient failures, then slows down", () => {
    expect(connectRetryDelay(0, "SSH connection failed: Connection refused")).toBe(FAST_DELAYS_MS[0]);
    expect(connectRetryDelay(3, "SSH connection failed: Connection refused")).toBe(FAST_DELAYS_MS[3]);
    expect(connectRetryDelay(FAST_DELAYS_MS.length, "SSH connection failed: Connection refused")).toBe(SLOW_RETRY_MS);
  });

  // Retrying these gets the host banned by fail2ban, or can never succeed.
  it("never retries what a retry cannot fix", () => {
    expect(connectRetryDelay(0, "Password authentication rejected — check the username and password.")).toBeNull();
    expect(connectRetryDelay(0, "FTP login failed: 530 Login incorrect")).toBeNull();
    expect(connectRetryDelay(0, "WARNING: Host key changed for h:22!\nStored   : a")).toBeNull();
    expect(connectRetryDelay(0, "Connection aborted by user.")).toBeNull();
    expect(connectRetryDelay(0, "Vault is locked", "vault-locked")).toBeNull();
    // A coded failure's message arrives translated, so only its code tells.
    expect(connectRetryDelay(0, "Mot de passe refusé.", "ssh-password-rejected")).toBeNull();
    expect(connectRetryDelay(0, "Connexion refusée.", "connection-refused")).toBe(FAST_DELAYS_MS[0]);
  });
});

describe("useConnectRetry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = (initial: Phase, target: unknown = "host-a") => {
    const retry = vi.fn();
    const hook = renderHook(({ phase, target }: { phase: Phase; target: unknown }) => useConnectRetry(phase, retry, target), {
      initialProps: { phase: initial, target },
    });
    return { retry, hook };
  };
  const fail = (): Phase => ({ tag: "error", message: "SSH connection failed: Connection refused" });

  it("retries a transient failure with a growing delay", () => {
    const { retry, hook } = setup(fail());
    expect(hook.result.current.retrying).toBe(true);
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);

    hook.rerender({ phase: { tag: "connecting" }, target: "host-a" });
    hook.rerender({ phase: fail(), target: "host-a" });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[1] - FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  // A host down for longer than the fast schedule must still come back on its own.
  it("keeps retrying slowly once the fast schedule is spent", () => {
    const { retry, hook } = setup(fail());
    for (let i = 0; i < FAST_DELAYS_MS.length; i++) {
      act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[i]); });
      hook.rerender({ phase: { tag: "connecting" }, target: "host-a" });
      hook.rerender({ phase: fail(), target: "host-a" });
    }
    expect(retry).toHaveBeenCalledTimes(FAST_DELAYS_MS.length);
    expect(hook.result.current.retrying).toBe(true);
    act(() => { vi.advanceTimersByTime(SLOW_RETRY_MS - 1); });
    expect(retry).toHaveBeenCalledTimes(FAST_DELAYS_MS.length);
    act(() => { vi.advanceTimersByTime(1); });
    expect(retry).toHaveBeenCalledTimes(FAST_DELAYS_MS.length + 1);
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

  const failTwice = (hook: ReturnType<typeof setup>["hook"], target = "host-a") => {
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    hook.rerender({ phase: { tag: "connecting" }, target });
    hook.rerender({ phase: fail(), target });
  };

  it("starts a fresh schedule after a connection that held", () => {
    const { retry, hook } = setup(fail());
    failTwice(hook);
    hook.rerender({ phase: { tag: "connected" }, target: "host-a" });
    act(() => { vi.advanceTimersByTime(STABLE_CONNECTION_MS); });
    hook.rerender({ phase: fail(), target: "host-a" });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("keeps climbing the schedule for a host that drops right after connecting", () => {
    const { retry, hook } = setup(fail());
    failTwice(hook);
    hook.rerender({ phase: { tag: "connected" }, target: "host-a" });
    hook.rerender({ phase: fail(), target: "host-a" });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[1] - FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh schedule for a new target, even straight from an error", () => {
    const { retry, hook } = setup(fail());
    failTwice(hook);
    failTwice(hook);
    retry.mockClear();
    hook.rerender({ phase: { tag: "connecting" }, target: "host-b" });
    hook.rerender({ phase: fail(), target: "host-b" });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh schedule on reset", () => {
    const { retry, hook } = setup(fail());
    failTwice(hook);
    failTwice(hook);
    retry.mockClear();
    act(() => { hook.result.current.reset(); });
    hook.rerender({ phase: { tag: "connecting" }, target: "host-a" });
    hook.rerender({ phase: fail(), target: "host-a" });
    act(() => { vi.advanceTimersByTime(FAST_DELAYS_MS[0]); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
