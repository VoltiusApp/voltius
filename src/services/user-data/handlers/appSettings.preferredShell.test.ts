import { describe, test, expect, beforeEach, vi } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

describe("appSettings.import", () => {
  beforeEach(() => useTerminalSettingsStore.setState({ preferredShell: "/usr/bin/fish" }));

  test("an absent preferredShell leaves the local shell alone", async () => {
    await appSettingsHandler.import({ terminal: { cursorStyle: "bar" } });
    expect(useTerminalSettingsStore.getState().preferredShell).toBe("/usr/bin/fish");
  });

  test("an explicit null still clears it", async () => {
    await appSettingsHandler.import({ terminal: { preferredShell: null } });
    expect(useTerminalSettingsStore.getState().preferredShell).toBeNull();
  });

  test("an explicit value still wins", async () => {
    await appSettingsHandler.import({ terminal: { preferredShell: "/bin/zsh" } });
    expect(useTerminalSettingsStore.getState().preferredShell).toBe("/bin/zsh");
  });

  test("an explicit undefined still clears it — the key was sent, unlike an absent leaf", async () => {
    await appSettingsHandler.import({ terminal: { preferredShell: undefined } });
    expect(useTerminalSettingsStore.getState().preferredShell).toBeNull();
  });

  test("a non-object terminal leaf is ignored, not thrown on", async () => {
    await expect(appSettingsHandler.import({ terminal: "bash" })).resolves.toBeUndefined();
    expect(useTerminalSettingsStore.getState().preferredShell).toBe("/usr/bin/fish");
  });
});
