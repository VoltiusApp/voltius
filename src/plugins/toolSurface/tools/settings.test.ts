import { describe, expect, test, vi } from "vitest";
import { buildSettingTools } from "./settings";
import type { ToolSurfacePorts } from "../coreTools";

const ports = (over: Partial<Record<string, unknown>> = {}) => ({
  api: {
    settings: {
      list: vi.fn(() => [
        { key: "toggles.scroll-minimap", type: "boolean", default: true, value: true,
          label: "Minimap", section: "appearance", writable: true },
      ]),
      get: vi.fn((key: string) =>
        key === "toggles.plugin-install-review"
          ? { key, type: "boolean", default: true, value: true, label: "Review",
              section: "plugins", writable: true, consequence: "Turns off the consent screen." }
          : key === "toggles.scroll-minimap"
            ? { key, type: "boolean", default: true, value: true, label: "Minimap",
                section: "appearance", writable: true }
            : undefined),
      set: vi.fn(() => ({ ok: true, result: { key: "k", requested: 1, effective: 1, changed: false } })),
      ...(over.settings as object ?? {}),
    },
  },
  approve: vi.fn(async () => ({ approve: true as const, scope: "mcp", via: "granted" as const })),
  audit: vi.fn(),
  owned: new Set<string>(),
  ...(over.rest as object ?? {}),
}) as unknown as ToolSurfacePorts;

const byName = (p: ToolSurfacePorts, name: string) =>
  buildSettingTools(p).find((t) => t.name === name)!;

describe("verbes de réglages", () => {
  test("setting_set est en risque prompt, les lectures en auto", () => {
    const p = ports();
    expect(byName(p, "setting_list").risk).toBe("auto");
    expect(byName(p, "setting_get").risk).toBe("auto");
    expect(byName(p, "setting_set").risk).toBe("prompt");
  });

  test("setting_get refuse une clé inconnue", async () => {
    const res = await byName(ports(), "setting_get").execute({ key: "nope.nope" });
    expect(res).toMatchObject({ refused: true });
  });

  test("une clé gardée refuse le premier appel et rend la conséquence, sans jamais approuver", async () => {
    const p = ports();
    const res = await byName(p, "setting_set")
      .execute({ key: "toggles.plugin-install-review", value: false }) as Record<string, unknown>;

    expect(res.refused).toBe(true);
    expect(String(res.error)).toContain("Turns off the consent screen.");
    expect(String(res.error)).toContain("confirm");
    expect((p.api.settings as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
    expect(p.approve).not.toHaveBeenCalled();
  });

  test("une clé gardée s'écrit avec confirm: true", async () => {
    const p = ports();
    const res = await byName(p, "setting_set")
      .execute({ key: "toggles.plugin-install-review", value: false, confirm: true });

    expect(res).toMatchObject({ ok: true });
    expect((p.api.settings as unknown as { set: ReturnType<typeof vi.fn> }).set).toHaveBeenCalledOnce();
  });

  test("une clé ordinaire n'exige aucun confirm", async () => {
    const p = ports();
    const res = await byName(p, "setting_set").execute({ key: "toggles.scroll-minimap", value: false });
    expect(res).toMatchObject({ ok: true });
  });

  test("un refus du domaine est passé tel quel, pas emballé en succès", async () => {
    const p = ports({ settings: { set: vi.fn(() => ({ ok: false, error: "Unknown setting \"x\"" })) } });
    const res = await byName(p, "setting_set").execute({ key: "toggles.scroll-minimap", value: 1 }) as Record<string, unknown>;
    expect(res.refused).toBe(true);
    expect(String(res.error)).toContain("Unknown setting");
  });

  test("un refus de l'approbation refuse l'écriture sans appeler le domaine", async () => {
    const p = ports({
      rest: {
        approve: vi.fn(async () => ({ approve: false as const, reason: "not now" })),
      },
    });
    const res = await byName(p, "setting_set")
      .execute({ key: "toggles.scroll-minimap", value: false }) as Record<string, unknown>;

    expect(res.refused).toBe(true);
    expect((p.api.settings as unknown as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
  });

  test("une écriture enregistre une ligne d'audit avec la portée et l'approbation de la décision", async () => {
    const p = ports();
    await byName(p, "setting_set").execute({ key: "toggles.scroll-minimap", value: false });
    expect(p.audit).toHaveBeenCalledWith(
      "mcp",
      "agent.setting_changed",
      { tool: "setting_set", approval: "granted", key: "toggles.scroll-minimap" },
      undefined,
    );
  });
});
