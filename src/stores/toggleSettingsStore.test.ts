// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { usePolicyStore } from "./policyStore";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { useAdminDefaultsStore } from "./adminDefaultsStore";
import { getToggle, hostToggle, useToggleSettingsStore } from "./toggleSettingsStore";
import { resolvePersistSession } from "./connectivitySettingsStore";

const ID = "cursor-blink" as const;
const KEY = `appSettings.toggles.${ID}`;
const NONE = { policy: {}, defaults: {} };
const machine = (policy = {}, defaults = {}) => usePolicyStore.setState({ machine: { policy, defaults } });

describe("toggle settings under policy", () => {
  beforeEach(() => {
    usePolicyStore.setState({ machine: NONE, server: NONE });
    useToggleSettingsStore.setState({ values: {} });
    useAdminDefaultsStore.setState({ applied: {} });
    useAppSettingsTimestampStore.setState({ clocks: {} });
  });

  it("locked toggle reads the policy value and ignores set", () => {
    machine({ [KEY]: true });
    useToggleSettingsStore.getState().set(ID, false);
    expect(getToggle(ID)).toBe(true);
    expect(useToggleSettingsStore.getState().values[ID]).toBeUndefined();
  });

  it("a per-host override wins unless the global toggle is locked", () => {
    expect(hostToggle("shell-integration", false)).toBe(false);
    expect(resolvePersistSession(true)).toBe(true);
    machine({ "appSettings.toggles.shell-integration": true, "appSettings.toggles.persistent-sessions": false });
    expect(hostToggle("shell-integration", false)).toBe(true);
    expect(resolvePersistSession(true)).toBe(false);
    machine();
    useToggleSettingsStore.setState({ values: { "shell-integration": false } });
    expect(hostToggle("shell-integration", undefined)).toBe(false);
  });

  it("unlocking restores the user's own value", () => {
    useToggleSettingsStore.getState().set(ID, false);
    machine({ [KEY]: true });
    expect(getToggle(ID)).toBe(true);
    machine();
    expect(getToggle(ID)).toBe(false);
  });
});
