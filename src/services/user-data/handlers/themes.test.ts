import { describe, test, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "@/stores/themeStore";
import { themesHandler } from "./themes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

describe("themesHandler", () => {
  beforeEach(() => {
    useThemeStore.setState({
      activeThemeId: "voltius",
      customThemes: [],
      mode: "manual",
      lightThemeId: "voltius-light",
      darkThemeId: "voltius",
      scheduleLightStart: "07:00",
      scheduleDarkStart: "19:00",
      location: null,
    });
  });

  test("exports every field of the themes section, coordinates included", () => {
    useThemeStore.setState({ mode: "schedule", scheduleLightStart: "06:30", darkThemeId: "dracula" });
    expect(themesHandler.export()).toMatchObject({
      activeThemeId: "voltius",
      mode: "schedule",
      lightThemeId: "voltius-light",
      darkThemeId: "dracula",
      scheduleLightStart: "06:30",
      scheduleDarkStart: "19:00",
      location: null,
    });
  });

  test("imports the automation fields, not just the active theme", async () => {
    await themesHandler.import({
      activeThemeId: "voltius-light",
      customThemes: [],
      mode: "schedule",
      lightThemeId: "solarized",
      darkThemeId: "dracula",
      scheduleLightStart: "05:00",
      scheduleDarkStart: "21:00",
      location: { lat: 48.85, lng: 2.35, label: "Paris", source: "manual" },
    });
    const s = useThemeStore.getState();
    expect(s.activeThemeId).toBe("voltius-light");
    expect(s.mode).toBe("schedule");
    expect(s.lightThemeId).toBe("solarized");
    expect(s.darkThemeId).toBe("dracula");
    expect(s.scheduleLightStart).toBe("05:00");
    expect(s.scheduleDarkStart).toBe("21:00");
    expect(s.location).toEqual({ lat: 48.85, lng: 2.35, label: "Paris", source: "manual" });
  });

  test("a section missing the new fields leaves the local values alone", async () => {
    useThemeStore.setState({ mode: "schedule", darkThemeId: "dracula" });
    await themesHandler.import({ activeThemeId: "voltius-light", customThemes: [] });
    const s = useThemeStore.getState();
    expect(s.activeThemeId).toBe("voltius-light");
    expect(s.mode).toBe("schedule");
    expect(s.darkThemeId).toBe("dracula");
  });
});
