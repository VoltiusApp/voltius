import { reduceLatch, initialLatch, type LatchState } from "./modifierLatchCore.ts";
import { test } from "vitest";

test("modifierLatchCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
}
{ const r = reduceLatch(initialLatch, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "armed", "ctrl armed after tap"); }
{ const armed: LatchState = { ctrl: "armed", alt: "off", shift: "off" }; const r = reduceLatch(armed, { type: "consume" }); assertEqual(r.ctrl, "off", "ctrl disarms after consume"); }
{ const r1 = reduceLatch(initialLatch, { type: "lock", mod: "ctrl" }); assertEqual(r1.ctrl, "locked", "ctrl locked"); const r2 = reduceLatch(r1, { type: "consume" }); assertEqual(r2.ctrl, "locked", "lock survives consume"); }
{ const locked: LatchState = { ctrl: "locked", alt: "off", shift: "off" }; const r = reduceLatch(locked, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "off", "tap toggles locked → off"); }
{ const armed: LatchState = { ctrl: "armed", alt: "off", shift: "off" }; const r = reduceLatch(armed, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "off", "tap toggles armed → off"); }
{ const both: LatchState = { ctrl: "armed", alt: "off", shift: "armed" }; const r = reduceLatch(both, { type: "consume" }); assertEqual(r, initialLatch, "consume spends an armed Shift with Ctrl"); }
{ const locked: LatchState = { ctrl: "off", alt: "off", shift: "locked" }; const r = reduceLatch(locked, { type: "consume" }); assertEqual(r.shift, "locked", "a locked Shift survives consume"); }
});
