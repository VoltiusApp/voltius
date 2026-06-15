import { isDoubleTap } from "./doubleTap.ts";

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const opts = { ms: 300, px: 24 };

// Close in time and space → double-tap.
assert(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 200, x: 105, y: 98 }, opts), "near tap is a double-tap");

// Too slow → not a double-tap.
assert(!isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 400, x: 100, y: 100 }, opts), "slow tap is not a double-tap");

// Too far → not a double-tap (a drag/scroll, or a different spot).
assert(!isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 100, x: 200, y: 100 }, opts), "far tap is not a double-tap");

// Exactly at the thresholds → inclusive.
assert(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 24, y: 0 }, opts), "threshold boundaries are inclusive");

console.log("doubleTap: OK");
