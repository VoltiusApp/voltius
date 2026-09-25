import { describe, it, expect } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { settingKey } from "../settingKeys";

describe("appSettings proxy", () => {
  it("round-trips the global proxy", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "http", host: "p", port: 3128 } } as never);
    const exported = appSettingsHandler.export() as { proxy?: unknown };
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import(exported);
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "http", host: "p", port: 3128 });
  });

  it("ignores an unknown mode", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import({ proxy: { mode: "carrier-pigeon" } });
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "none" });
  });

  it("is device-scoped", () => {
    expect(settingKey("appSettings.proxy")?.deviceScoped).toBe(true);
  });
});
