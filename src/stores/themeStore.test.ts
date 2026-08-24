import { test, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "./themeStore";
import { DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, useUIStore } from "./uiStore";

const invokeMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  useThemeStore.setState({
    activeThemeId: DEFAULT_THEME_ID,
    mode: "manual",
    lightThemeId: DEFAULT_LIGHT_THEME_ID,
    darkThemeId: DEFAULT_THEME_ID,
    resolvedPhase: "dark",
  });
});

test("manual mode: effective id equals activeThemeId", () => {
  const s = useThemeStore.getState();
  s.setMode("manual");
  useThemeStore.setState({ activeThemeId: "nord" });
  expect(useThemeStore.getState().getEffectiveThemeId()).toBe("nord");
});

test("auto mode: effective id follows resolvedPhase → light/dark pair", () => {
  const s = useThemeStore.getState();
  s.setMode("system");
  s.setLightThemeId("voltius-light");
  s.setDarkThemeId("dracula");
  s.setResolvedPhase("dark");
  expect(useThemeStore.getState().getEffectiveThemeId()).toBe("dracula");
  useThemeStore.getState().setResolvedPhase("light");
  expect(useThemeStore.getState().getEffectiveThemeId()).toBe("voltius-light");
});

test("getActiveTheme resolves the effective theme object", () => {
  const s = useThemeStore.getState();
  s.setMode("system");
  s.setDarkThemeId("dracula");
  s.setResolvedPhase("dark");
  expect(useThemeStore.getState().getActiveTheme().id).toBe("dracula");
});

test("toggleLightDark flips active between the pair and forces manual", () => {
  const s = useThemeStore.getState();
  s.setLightThemeId("voltius-light");
  s.setDarkThemeId("voltius");
  useThemeStore.setState({ activeThemeId: "voltius", mode: "system" });
  useThemeStore.getState().toggleLightDark();
  let st = useThemeStore.getState();
  expect(st.mode).toBe("manual");
  expect(st.activeThemeId).toBe("voltius-light");
  useThemeStore.getState().toggleLightDark();
  expect(useThemeStore.getState().activeThemeId).toBe("voltius");
});

test("toggleLightDark flips based on the displayed effective theme when automation is active", () => {
  const s = useThemeStore.getState();
  s.setLightThemeId("voltius-light");
  s.setDarkThemeId("voltius");
  // Automation showing LIGHT (system mode, resolvedPhase light) but activeThemeId still the dark pick:
  useThemeStore.setState({ activeThemeId: "voltius", mode: "system", resolvedPhase: "light" });
  useThemeStore.getState().toggleLightDark();
  const st = useThemeStore.getState();
  expect(st.mode).toBe("manual");
  expect(st.activeThemeId).toBe("voltius"); // displayed light → toggles to the DARK theme
});

test("getAutomationConfig returns the current config shape", () => {
  const s = useThemeStore.getState();
  s.setMode("schedule");
  s.setSchedule("06:30", "20:15");
  const cfg = useThemeStore.getState().getAutomationConfig();
  expect(cfg).toMatchObject({ mode: "schedule", scheduleLightStart: "06:30", scheduleDarkStart: "20:15" });
});

test("setResolvedPhase does not bump updatedAt (device-local, not synced)", () => {
  const before = useThemeStore.getState().updatedAt;
  useThemeStore.getState().setResolvedPhase("light");
  expect(useThemeStore.getState().updatedAt).toBe(before);
});

test("theme.json carries no location — the coordinates are device-scoped (#163)", async () => {
  invokeMock.mockClear();
  useThemeStore.setState({ location: { lat: 48.85, lng: 2.35, label: "Paris", source: "manual" } });
  useThemeStore.getState().persist();
  const calls = invokeMock.mock.calls as unknown as [string, { state: string }][];
  const [cmd, args] = calls[calls.length - 1];
  expect(cmd).toBe("theme_save");
  expect("location" in JSON.parse(args.state)).toBe(false);
});

test("loadFromDisk leaves the local location alone when an old file still has one", async () => {
  useThemeStore.setState({ location: { lat: 48.85, lng: 2.35, label: "Paris", source: "manual" } });
  invokeMock.mockResolvedValueOnce(
    JSON.stringify({
      updatedAt: "2026-08-23T00:00:00.000Z",
      activeThemeId: "dracula",
      customThemes: [],
      location: { lat: 35.68, lng: 139.69, label: "Tokyo", source: "manual" },
    }),
  );
  await useThemeStore.getState().loadFromDisk();
  const s = useThemeStore.getState();
  expect(s.activeThemeId).toBe("dracula");
  expect(s.location).toEqual({ lat: 48.85, lng: 2.35, label: "Paris", source: "manual" });
});

test("getActiveTheme folds in the terminal font size override", () => {
  const themed = useThemeStore.getState().getActiveTheme().terminalFontSize;
  useUIStore.getState().setTerminalFontSize(themed + 5);
  expect(useThemeStore.getState().getActiveTheme().terminalFontSize).toBe(themed + 5);
  // Every other field still comes from the theme itself.
  expect(useThemeStore.getState().getActiveTheme().id).toBe(DEFAULT_THEME_ID);
  useUIStore.getState().setTerminalFontSize(null);
  expect(useThemeStore.getState().getActiveTheme().terminalFontSize).toBe(themed);
});

test("the override is clamped to a size xterm can render", () => {
  useUIStore.getState().setTerminalFontSize(999);
  expect(useThemeStore.getState().getActiveTheme().terminalFontSize).toBe(MAX_TERMINAL_FONT_SIZE);
  useUIStore.getState().setTerminalFontSize(0);
  expect(useThemeStore.getState().getActiveTheme().terminalFontSize).toBe(MIN_TERMINAL_FONT_SIZE);
  useUIStore.getState().setTerminalFontSize(null);
});
