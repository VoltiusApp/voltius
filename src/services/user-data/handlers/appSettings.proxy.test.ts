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

  it("drops a string port instead of forwarding it to the Rust IPC", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import({ proxy: { mode: "socks5", host: "p", port: "3128" } });
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "socks5", host: "p" });
  });

  it("drops a non-string host", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import({ proxy: { mode: "socks5", host: {}, port: 1080 } });
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "socks5", port: 1080 });
  });

  it("does not store an extra key the sender sent along", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import({ proxy: { mode: "socks5", host: "p", port: 1080, password: "x" } });
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "socks5", host: "p", port: 1080 });
  });

  it("ignores a non-object proxy", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "none" } } as never);
    await appSettingsHandler.import({ proxy: "socks5" });
    expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "none" });
  });

  it("is device-scoped", () => {
    expect(settingKey("appSettings.proxy")?.deviceScoped).toBe(true);
  });
});
