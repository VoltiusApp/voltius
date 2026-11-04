// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { usePolicyStore } from "./policyStore";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { isAdminDefaulted, useAdminDefaultsStore } from "./adminDefaultsStore";
import { applyToggleDefaults, getToggle, useToggleSettingsStore } from "./toggleSettingsStore";

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

  it("unlocking restores the user's own value", () => {
    useToggleSettingsStore.getState().set(ID, false);
    machine({ [KEY]: true });
    expect(getToggle(ID)).toBe(true);
    machine();
    expect(getToggle(ID)).toBe(false);
  });

  it("defaults apply once", () => {
    machine({}, { [KEY]: true });
    applyToggleDefaults();
    expect(useToggleSettingsStore.getState().values[ID]).toBe(true);
    useToggleSettingsStore.getState().set(ID, false);
    applyToggleDefaults();
    expect(useToggleSettingsStore.getState().values[ID]).toBe(false);
  });

  it("leaves an existing user value untouched", () => {
    useToggleSettingsStore.getState().set(ID, false);
    machine({}, { [KEY]: true });
    applyToggleDefaults();
    expect(useToggleSettingsStore.getState().values[ID]).toBe(false);
    expect(isAdminDefaulted(KEY)).toBe(false);
  });

  it("writes the default without a sync clock and a user edit clears the mark", () => {
    machine({}, { [KEY]: true });
    applyToggleDefaults();
    expect(useAppSettingsTimestampStore.getState().clocks[`toggles.${ID}`]).toBeUndefined();
    expect(isAdminDefaulted(KEY)).toBe(true);
    useToggleSettingsStore.getState().set(ID, false);
    expect(isAdminDefaulted(KEY)).toBe(false);
  });
});
