import { describe, it, expect } from "vitest";
import { requireOpenSession, requireShellSession, requireSshSession, isRemoteSession } from "./sessionTargets";
import type { PluginAPI } from "@/plugins/api";

const api = {
  sessions: {
    list: () => [
      { id: "ssh1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "h" },
      { id: "loc1", type: "local", status: "connected", connectionId: "", connectionName: "local" },
      { id: "ser1", type: "serial", status: "connected", connectionId: "c3", connectionName: "ttyUSB0" },
    ],
  },
} as unknown as PluginAPI;

describe("session target helpers", () => {
  it("refuses an unknown id", () => {
    expect(() => requireOpenSession(api, "nope")).toThrow(/no open session with id "nope"/);
  });

  // Everything downstream of requireShellSession writes shell command text.
  it("accepts ssh and local but refuses a serial session by type", () => {
    expect(requireShellSession(api, "ssh1").id).toBe("ssh1");
    expect(requireShellSession(api, "loc1").id).toBe("loc1");
    expect(() => requireShellSession(api, "ser1")).toThrow(/"serial"/);
  });

  it("treats only an ssh session as remote", () => {
    expect(isRemoteSession(api, "ssh1")).toBe(true);
    expect(isRemoteSession(api, "loc1")).toBe(false);
    expect(() => isRemoteSession(api, "ser1")).toThrow(/"serial"/);
  });

  it("requireSshSession refuses local and serial alike", () => {
    expect(requireSshSession(api, "ssh1")).toBe("ssh1");
    expect(() => requireSshSession(api, "loc1")).toThrow(/not an SSH session/);
    expect(() => requireSshSession(api, "ser1")).toThrow(/not an SSH session/);
  });
});
