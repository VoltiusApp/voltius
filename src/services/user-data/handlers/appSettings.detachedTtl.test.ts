// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";

describe("appSettings handler — detachedTtlHours", () => {
  beforeEach(() => {
    useConnectivitySettingsStore.setState({ detachedTtlHours: 24 });
  });

  it("exports and imports detachedTtlHours", async () => {
    useConnectivitySettingsStore.setState({ detachedTtlHours: 72 });
    const data = appSettingsHandler.export() as { detachedTtlHours?: number };
    expect(data.detachedTtlHours).toBe(72);
    useConnectivitySettingsStore.setState({ detachedTtlHours: 24 });
    await appSettingsHandler.import(data);
    expect(useConnectivitySettingsStore.getState().detachedTtlHours).toBe(72);
  });

  it("ignores values outside the presets", async () => {
    await appSettingsHandler.import({ detachedTtlHours: 5 });
    expect(useConnectivitySettingsStore.getState().detachedTtlHours).toBe(24);
  });
});
