import { reduceLatch, initialLatch, type LatchState } from "./modifierLatchCore.ts";
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
  console.log(`PASS ${msg}`);
}
{ const r = reduceLatch(initialLatch, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "armed", "ctrl armed after tap"); }
{ const armed: LatchState = { ctrl: "armed", alt: "off" }; const r = reduceLatch(armed, { type: "consume" }); assertEqual(r.ctrl, "off", "ctrl disarms after consume"); }
{ const r1 = reduceLatch(initialLatch, { type: "lock", mod: "ctrl" }); assertEqual(r1.ctrl, "locked", "ctrl locked"); const r2 = reduceLatch(r1, { type: "consume" }); assertEqual(r2.ctrl, "locked", "lock survives consume"); }
{ const locked: LatchState = { ctrl: "locked", alt: "off" }; const r = reduceLatch(locked, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "off", "tap toggles locked → off"); }
{ const armed: LatchState = { ctrl: "armed", alt: "off" }; const r = reduceLatch(armed, { type: "tap", mod: "ctrl" }); assertEqual(r.ctrl, "off", "tap toggles armed → off"); }
console.log("ALL PASS");
