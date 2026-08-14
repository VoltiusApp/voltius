import { beforeEach, describe, expect, test } from "vitest";
import { getSetting, listSettings, setSetting, settingConsequence } from "./settings";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";

describe("domaine settings", () => {
  beforeEach(() => {
    useToggleSettingsStore.setState({ values: {} });
    useTerminalSettingsStore.setState({ scrollbackLines: 1000 });
  });

  test("list projette la valeur courante et un libellé traduit", () => {
    const view = listSettings().find((v) => v.key === "toggles.scroll-minimap")!;
    expect(view.value).toBe(true);
    expect(view.label).not.toBe("");
    expect(view.label).not.toContain("settings.toggleDefs");
  });

  test("list filtre par section", () => {
    const views = listSettings({ section: "sftp" });
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) expect(v.section).toBe("sftp");
  });

  test("list filtre par préfixe", () => {
    for (const v of listSettings({ prefix: "sync.type." })) {
      expect(v.key.startsWith("sync.type.")).toBe(true);
    }
  });

  test("list writableOnly exclut les valeurs structurées", () => {
    for (const v of listSettings({ writableOnly: true })) expect(v.writable).toBe(true);
    expect(listSettings({ writableOnly: true }).some((v) => v.key.startsWith("shortcuts."))).toBe(false);
  });

  test("get rend une clé inconnue comme indéfinie", () => {
    expect(getSetting("nope.nope")).toBeUndefined();
  });

  test("set écrit et rend la valeur effective", () => {
    const res = setSetting("toggles.scroll-minimap", false);
    expect(res).toEqual({
      ok: true,
      result: { key: "toggles.scroll-minimap", requested: false, effective: false, changed: false },
    });
    expect(getSetting("toggles.scroll-minimap")!.value).toBe(false);
  });

  // 99_999_999 is above MAX_SCROLLBACK_LINES, so `validate` refuses it before
  // any write happens (below). This case instead stays within [min, max] but
  // is fractional, which `setScrollbackLines` rounds via `clampScrollbackLines` —
  // proving `setSetting` re-reads through the manifest rather than echoing
  // back what it was handed.
  test("set signale une valeur corrigée par le store", () => {
    const res = setSetting("terminal.scrollbackLines", 50_000.6);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.requested).toBe(50_000.6);
    expect(res.result.effective).toBe(50_001);
    expect(res.result.effective).not.toBe(50_000.6);
    expect(res.result.changed).toBe(true);
  });

  test("set refuse une valeur hors bornes sans écrire", () => {
    const res = setSetting("terminal.scrollbackLines", 99_999_999);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("maximum");
    expect(getSetting("terminal.scrollbackLines")!.value).toBe(1000);
  });

  test("set refuse un type erroné sans écrire", () => {
    const res = setSetting("toggles.scroll-minimap", "yes");
    expect(res.ok).toBe(false);
    expect(getSetting("toggles.scroll-minimap")!.value).toBe(true);
  });

  test("set refuse une valeur hors enum", () => {
    const res = setSetting("connectivity.keepalivePreset", "turbo");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("turbo");
  });

  test("set refuse une clé inconnue", () => {
    expect(setSetting("nope.nope", 1).ok).toBe(false);
  });

  test("la conséquence ne se déclenche que dans le sens qui désarme", () => {
    expect(settingConsequence("toggles.plugin-install-review", false)).toBeTruthy();
    expect(settingConsequence("toggles.plugin-install-review", true)).toBeUndefined();
    expect(settingConsequence("updater.autoUpdate", false)).toBeTruthy();
    expect(settingConsequence("updater.autoUpdate", true)).toBeUndefined();
  });

  test("une clé sans garde-fou, ou inconnue, n'a pas de conséquence", () => {
    expect(settingConsequence("toggles.scroll-minimap", false)).toBeUndefined();
    expect(settingConsequence("nope.nope", false)).toBeUndefined();
  });

  test("set refuse une valeur structurée", () => {
    const key = listSettings().find((v) => v.key.startsWith("shortcuts."))!.key;
    const res = setSetting(key, "Ctrl+K");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("read-only");
  });
});
