import { test, expect } from "vitest";
import { defaultSaveTarget, identityOverride, saveTargetOptions } from "./saveTarget";

const t = ((k: string, o?: Record<string, string>) => (o ? `${k}:${o.vault}` : k)) as never;

test("own identity remembers for you: this host or the whole vault", () => {
  expect(saveTargetOptions("own", true, "Ops", t).map((o) => [o.value, o.label, !!o.disabled])).toEqual([
    ["pick", "terminal.overlay.saveTarget.thisHost", false],
    ["vault-default", "terminal.overlay.saveTarget.allVaultHosts:Ops", false],
  ]);
  expect(defaultSaveTarget("own", true)).toBe("pick");
});

test("team identity: editors default to everyone, others can only keep it for themselves", () => {
  expect(defaultSaveTarget("team", true)).toBe("host");
  expect(defaultSaveTarget("team", false)).toBe("pick");
  expect(saveTargetOptions("team", false, "Ops", t).find((o) => o.value === "host")?.disabled).toBe(true);
});

test("everyone keeps today's override shape; picks add saveAs", () => {
  expect(identityOverride("i1", "host")).toEqual({ identityId: "i1" });
  expect(identityOverride("i1", "pick")).toEqual({ identityId: "i1", saveAs: "pick" });
  expect(identityOverride("i1", "vault-default")).toEqual({ identityId: "i1", saveAs: "vault-default" });
});
