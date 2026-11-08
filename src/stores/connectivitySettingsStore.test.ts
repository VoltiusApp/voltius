// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveDetachedTtlSecs,
  resolveHostKeepalive,
  getGlobalKeepalivePreset,
  useConnectivitySettingsStore,
} from "./connectivitySettingsStore";
import { useToggleSettingsStore } from "./toggleSettingsStore";
import { usePolicyStore, writeUnlessLocked } from "./policyStore";

const empty = { policy: {}, defaults: {} };
const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: empty });
const KA = "appSettings.keepalivePreset";

describe("connectivity readers under policy", () => {
  beforeEach(() => {
    usePolicyStore.setState({ machine: empty, server: empty, issues: [] });
    useConnectivitySettingsStore.setState({ keepalivePreset: "balanced", detachedTtlHours: 72 } as never);
    useToggleSettingsStore.setState({ values: { "detached-session-ttl": false } } as never);
  });

  it("writeUnlessLocked skips the write under an enforced lock", () => {
    let n = 0;
    writeUnlessLocked(KA, () => n++);
    withPolicy({ [KA]: "tolerant" });
    writeUnlessLocked(KA, () => n++);
    expect(n).toBe(1);
  });

  it("setter is a no-op under a lock", () => {
    withPolicy({ [KA]: "tolerant" });
    useConnectivitySettingsStore.getState().setKeepalivePreset("off");
    expect(useConnectivitySettingsStore.getState().keepalivePreset).toBe("balanced");
    expect(getGlobalKeepalivePreset()).toBe("tolerant");
  });

  it("host keepalive is bounded by the global range", () => {
    withPolicy({ [KA]: { $range: { allowed: ["balanced", "tolerant"] } } });
    expect(resolveHostKeepalive("off")).toBe("balanced");
    expect(resolveHostKeepalive("tolerant")).toBe("tolerant");
  });

  it("host keepalive cannot bypass a lock", () => {
    withPolicy({ [KA]: "tolerant" });
    expect(resolveHostKeepalive("off")).toBe("tolerant");
  });

  it("host keepalive falls back to global without policy", () => {
    expect(resolveHostKeepalive(undefined)).toBe("balanced");
    expect(resolveHostKeepalive("off")).toBe("off");
  });

  it("ttl range forces expiry on and bounds the stored hours", () => {
    withPolicy({ "appSettings.detachedTtlHours": { $range: { max: 24 } } });
    expect(resolveDetachedTtlSecs()).toBe(86400);
  });

  it("ttl plain lock forces expiry on with the locked hours", () => {
    withPolicy({ "appSettings.detachedTtlHours": 6 });
    expect(resolveDetachedTtlSecs()).toBe(6 * 3600);
  });

  it("ttl is off when stored off and nothing is set", () => {
    expect(resolveDetachedTtlSecs()).toBeNull();
  });
});
