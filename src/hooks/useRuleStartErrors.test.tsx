import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BackendError } from "@/services/backendErrors";
import type { ActiveTunnel, PortForwardingRule } from "@/types";
import { useRuleStartErrors } from "./useRuleStartErrors";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { address?: string }) => (k === "errors.bind-address-unavailable" ? `no address ${o?.address}` : "") }),
}));
const openRuleTunnel = vi.hoisted(() => vi.fn());
vi.mock("@/services/portForwardingTunnels", () => ({ openRuleTunnel }));

const rule = { id: "r1", name: "Office" } as PortForwardingRule;

describe("useRuleStartErrors", () => {
  it("keeps the reason a rule failed to start until the next attempt", async () => {
    const { result } = renderHook(() => useRuleStartErrors());

    openRuleTunnel.mockRejectedValueOnce(new BackendError("bind-address-unavailable", "raw", { address: "192.0.2.1" }));
    await act(() => result.current.startRuleOn("s1", rule));
    expect(openRuleTunnel).toHaveBeenCalledWith("s1", rule);
    expect(result.current.errorFor("r1")).toBe("no address 192.0.2.1");

    openRuleTunnel.mockResolvedValueOnce({});
    await act(() => result.current.startRuleOn("s1", rule));
    expect(result.current.errorFor("r1")).toBeUndefined();
  });

  it("falls back to the backend's own words for a failure with no code", async () => {
    const { result } = renderHook(() => useRuleStartErrors());
    openRuleTunnel.mockRejectedValueOnce("SSH error: channel closed");
    await act(() => result.current.startRuleOn("s1", rule));
    expect(result.current.errorFor("r1")).toBe("SSH error: channel closed");
  });

  it("lets a tunnel that exists speak for itself", async () => {
    const { result } = renderHook(() => useRuleStartErrors());
    openRuleTunnel.mockRejectedValueOnce("stale");
    await act(() => result.current.startRuleOn("s1", rule));

    expect(result.current.errorFor("r1", { state: "active" } as ActiveTunnel)).toBeUndefined();
    expect(result.current.errorFor("r1", { state: { error: "port taken" } } as ActiveTunnel)).toBe("port taken");
  });
});
