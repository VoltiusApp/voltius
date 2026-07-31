import { describe, test, expect } from "vitest";
import { useUIStore } from "./uiStore";

describe("uiStore persist migration v0 -> v1", () => {
  test("drops a stale un-namespaced 'plugin:<id>' rightPanelSection back to the default", async () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const result = await migrate({ rightPanelSection: "plugin:monitoring" }, 0);
    expect((result as { rightPanelSection: string }).rightPanelSection).toBe("themes");
  });

  test("leaves a builtin rightPanelSection untouched", async () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const result = await migrate({ rightPanelSection: "ports" }, 0);
    expect((result as { rightPanelSection: string }).rightPanelSection).toBe("ports");
  });

  test("does not touch state already at the current version", async () => {
    const migrate = useUIStore.persist.getOptions().migrate!;
    const result = await migrate({ rightPanelSection: "plugin:monitoring" }, 1);
    expect((result as { rightPanelSection: string }).rightPanelSection).toBe("plugin:monitoring");
  });
});
