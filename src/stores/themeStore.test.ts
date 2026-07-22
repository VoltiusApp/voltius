import { test, expect, beforeEach } from "vitest";
import { useThemeStore } from "./themeStore";
import { DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";

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
