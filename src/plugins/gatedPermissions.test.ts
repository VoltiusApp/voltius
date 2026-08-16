import { describe, test, it, expect } from "vitest";
import i18n from "@/i18n";
import {
  GATED_PERMISSIONS, NON_DANGER_GATED_PERMISSIONS, isGatedPermission,
  isNonDangerGatedPermission,
  describePermissions, hasGatedPermission, requiresInstallConsent,
} from "./gatedPermissions";

describe("gatedPermissions", () => {
  test("terminal read/stream are gated", () => {
    expect(GATED_PERMISSIONS.has("terminal:read")).toBe(true);
    expect(isGatedPermission("terminal:stream")).toBe(true);
  });

  test("ordinary permissions are not gated", () => {
    expect(isGatedPermission("sessions:read")).toBe(false);
    expect(isGatedPermission("right-panel")).toBe(false);
  });

  test("keychain read/write are gated", () => {
    expect(isGatedPermission("keychain:read")).toBe(true);
    expect(isGatedPermission("keychain:write")).toBe(true);
  });

  test("terminal:write is gated", () => {
    expect(isGatedPermission("terminal:write")).toBe(true);
    expect(GATED_PERMISSIONS.has("terminal:write")).toBe(true);
  });

  test("proxmox:read and processes:read are gated", () => {
    expect(isGatedPermission("proxmox:read")).toBe(true);
    expect(isGatedPermission("processes:read")).toBe(true);
  });

  test("every non-danger gated perm is itself gated — the subset invariant", () => {
    for (const perm of NON_DANGER_GATED_PERMISSIONS) {
      expect(GATED_PERMISSIONS.has(perm), `${perm} is non-danger but not gated`).toBe(true);
    }
  });

  test("the read tiers are gated but NOT danger", () => {
    for (const perm of ["docker:read", "proxmox:read", "processes:read", "metrics:read"]) {
      const [d] = describePermissions([perm]);
      expect(d.gated, perm).toBe(true);
      expect(d.danger, perm).toBe(false);
      expect(isNonDangerGatedPermission(perm)).toBe(true);
    }
  });

  test("their :manage counterparts stay danger", () => {
    for (const perm of ["docker:manage", "proxmox:manage", "processes:manage"]) {
      const [d] = describePermissions([perm]);
      expect(d.gated, perm).toBe(true);
      expect(d.danger, perm).toBe(true);
    }
  });

  test("secret-exposing reads stay danger even though they are reads", () => {
    for (const perm of ["terminal:read", "terminal:stream", "keychain:read"]) {
      const [d] = describePermissions([perm]);
      expect(d.danger, perm).toBe(true);
      expect(isNonDangerGatedPermission(perm)).toBe(false);
    }
  });

  test("a non-danger gated perm still forces install consent", () => {
    expect(requiresInstallConsent(["docker:read"], false)).toBe(true);
    expect(hasGatedPermission(["docker:read"])).toBe(true);
  });

  test("every gated permission has consent copy — none render as a bare string", () => {
    const [descriptors] = [describePermissions([...GATED_PERMISSIONS])];
    for (const d of descriptors) {
      expect(d.known, `${d.perm} has no PERMISSION_COPY entry`).toBe(true);
      expect(d.labelKey).not.toBe("");
      expect(d.descriptionKey).not.toBe("");
    }
  });

  test("P9 permissions are gated, described, and their copy resolves in all four languages", async () => {
    const i18n = (await import("@/i18n")).default;
    for (const perm of ["plugins:manage", "importexport:read", "importexport:write"]) {
      expect(hasGatedPermission([perm])).toBe(true);
      const [d] = describePermissions([perm]);
      expect(d.known).toBe(true);
      for (const lng of ["en", "fr", "ru", "zh"]) {
        for (const key of [d.labelKey, d.descriptionKey]) {
          const text = i18n.t(key, { lng });
          expect(text).not.toBe(key);
          // An object node resolves to an i18next diagnostic string, not a failure.
          expect(text.startsWith("key '")).toBe(false);
        }
      }
    }
  });

  test("importexport:read is danger tier, not the read-only tier", () => {
    expect(isNonDangerGatedPermission("importexport:read")).toBe(false);
  });
});

describe("describePermissions / consent decision", () => {
  test("returns a descriptor for every perm, order preserved, none filtered", () => {
    const d = describePermissions(["sessions:read", "terminal:read", "storage"]);
    expect(d.map((x) => x.perm)).toEqual(["sessions:read", "terminal:read", "storage"]);
  });

  test("gated perms carry gated+danger and copy keys", () => {
    const [d] = describePermissions(["terminal:write"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.terminalWrite.label");
    expect(d.descriptionKey).toBe("settings.plugins.permissionModal.permissions.terminalWrite.description");
  });

  test("a benign known perm is not danger", () => {
    const [d] = describePermissions(["connections:read"]);
    expect(d.gated).toBe(false);
    expect(d.danger).toBe(false);
    expect(d.known).toBe(true);
  });

  test("an unknown perm falls back to known:false with empty copy keys", () => {
    const [d] = describePermissions(["some:future-perm"]);
    expect(d.known).toBe(false);
    expect(d.labelKey).toBe("");
    expect(d.descriptionKey).toBe("");
  });

  test("UI-contribution perms enforced by the runtime also resolve to known copy", () => {
    const [d] = describePermissions(["themes"]);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.themes.label");
  });

  test("hasGatedPermission detects a gated perm anywhere in the list", () => {
    expect(hasGatedPermission(["storage", "terminal:read"])).toBe(true);
    expect(hasGatedPermission(["storage", "http"])).toBe(false);
  });

  test("requiresInstallConsent: review on always prompts; review off prompts only for gated", () => {
    expect(requiresInstallConsent(["storage"], true)).toBe(true);
    expect(requiresInstallConsent(["storage"], false)).toBe(false);
    expect(requiresInstallConsent(["terminal:read"], false)).toBe(true);
  });
});

describe("audit permission", () => {
  test("is gated and danger-styled with known copy", () => {
    const [d] = describePermissions(["audit"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.audit.label");
  });
});

describe("vaults and folders permissions", () => {
  test("all four are gated", () => {
    for (const perm of ["vaults:read", "vaults:write", "folders:read", "folders:write"]) {
      expect(isGatedPermission(perm), perm).toBe(true);
    }
  });

  test("the read tiers list inventory, so they are gated but not danger", () => {
    for (const perm of ["vaults:read", "folders:read"]) {
      const [d] = describePermissions([perm]);
      expect(d.gated, perm).toBe(true);
      expect(d.danger, perm).toBe(false);
    }
  });

  test("the write tiers can destroy user data, so they stay danger", () => {
    for (const perm of ["vaults:write", "folders:write"]) {
      const [d] = describePermissions([perm]);
      expect(d.danger, perm).toBe(true);
    }
  });

  test("they are distinct from the plugin-scoped singular vault:* storage perms", () => {
    expect(isGatedPermission("vault:read")).toBe(false);
    const [singular] = describePermissions(["vault:read"]);
    const [plural] = describePermissions(["vaults:read"]);
    expect(singular.labelKey).not.toBe(plural.labelKey);
  });
});

describe("mcp:contribute permission", () => {
  test("mcp:contribute is gated and danger-tier", () => {
    const [d] = describePermissions(["mcp:contribute"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.mcpContribute.label");
  });
});

describe("snippets:run", () => {
  test("is gated and danger-styled — it executes commands on the user's hosts", () => {
    const [d] = describePermissions(["snippets:run"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.snippetsRun.label");
  });

  test("reading or editing snippets stays ungated — only running is", () => {
    const [read, write] = describePermissions(["snippets:read", "snippets:write"]);
    expect(read.gated).toBe(false);
    expect(write.gated).toBe(false);
  });
});

describe("ports:forward", () => {
  test("is gated and danger-styled", () => {
    const [d] = describePermissions(["ports:forward"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.portsForward.label");
  });
});

describe("P5 permissions", () => {
  test("gates all three, with only the write tier danger-styled", () => {
    const [read, write, health] = describePermissions(["transfers:read", "transfers:write", "health:read"]);
    expect(read).toMatchObject({ gated: true, danger: false, known: true });
    expect(write).toMatchObject({ gated: true, danger: true, known: true });
    expect(health).toMatchObject({ gated: true, danger: false, known: true });
  });
});

test("les permissions de P8 sont gatées et décrites", () => {
  const [read, write, account] = describePermissions(["settings:read", "settings:write", "account:read"]);

  expect(read.gated).toBe(true);
  expect(read.danger).toBe(false);
  expect(read.known).toBe(true);

  expect(write.gated).toBe(true);
  expect(write.danger).toBe(true);

  expect(account.gated).toBe(true);
  expect(account.danger).toBe(false);

  for (const d of [read, write, account]) {
    expect(i18n.t(d.labelKey)).not.toBe(d.labelKey);
    expect(i18n.t(d.descriptionKey)).not.toBe(d.descriptionKey);
  }
});

describe("pane permissions", () => {
  it("are described in plain language but never gated", () => {
    const [read, write] = describePermissions(["panes:read", "panes:write"]);
    expect(read.known).toBe(true);
    expect(read.labelKey).toBe("settings.plugins.permissionModal.permissions.panesRead.label");
    expect(read.gated).toBe(false);
    expect(write.known).toBe(true);
    expect(write.gated).toBe(false);
  });
});
