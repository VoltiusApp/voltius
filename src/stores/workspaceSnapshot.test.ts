import {
  buildSnapshot,
  parseSnapshot,
  SNAPSHOT_VERSION,
  type SessionInput,
  type SnapshotLayout,
} from "./workspaceSnapshotCore.ts";
import { test } from "vitest";

test("workspaceSnapshot", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

const layout: SnapshotLayout = {
  splitTabs: [],
  activeSplitTabId: null,
  splitTabActive: false,
  titlebarOrder: ["session:s1", "session:s3"],
};

const sessions: SessionInput[] = [
  { id: "s1", type: "ssh", connectionId: "c1", connectionName: "web-01", persist: true, encoding: "utf-8" },
  { id: "s2", type: "multiplayer", connectionId: "c2", connectionName: "shared" },
  { id: "s3", type: "local", connectionId: "local", connectionName: "zsh", localShell: "/bin/zsh" },
  { id: "s4", type: "serial", connectionId: "serial-ephemeral", connectionName: "Serial" },
  {
    id: "s5", type: "serial", connectionId: "c5", connectionName: "UART",
    serialConfig: { sessionId: "s5", port: "/dev/ttyUSB0", baud: 115200 },
  },
  { id: "s6", type: "ssh", connectionId: "c6", connectionName: "docker", containerExec: { kind: "docker" } },
];

// --- buildSnapshot ---
const snap = buildSnapshot({
  sessions,
  cwds: { s1: "/var/www", s3: "/home/me" },
  layout,
  activeSessionId: "s1",
  now: new Date("2026-06-10T12:00:00Z"),
});
assertEqual(snap.version, SNAPSHOT_VERSION, "snapshot carries current version");
assertEqual(snap.savedAt, "2026-06-10T12:00:00.000Z", "savedAt is the injected clock");
assertEqual(
  snap.sessions.map((s) => s.id),
  ["s1", "s3", "s5"],
  "filters out multiplayer, unconfigured ephemeral serial, and container-exec sessions",
);
assertEqual(snap.sessions[0].cwd, "/var/www", "cwd attaches from the cwd map");
assertEqual(snap.sessions[0].persist, true, "persist survives");
assertEqual(snap.sessions[0].encoding, "utf-8", "encoding survives");
assertEqual(snap.sessions[1].persist, false, "persist defaults to false");
assertEqual(snap.sessions[1].localShell, "/bin/zsh", "localShell survives");
assertEqual(snap.sessions[2].serialConfig?.port, "/dev/ttyUSB0", "serial config survives");
assertEqual(snap.activeSessionId, "s1", "active session kept when restorable");

const snapActiveFiltered = buildSnapshot({ sessions, cwds: {}, layout, activeSessionId: "s2" });
assertEqual(snapActiveFiltered.activeSessionId, null, "active session nulled when it was filtered out");

// --- scroll offset ---
const snapScroll = buildSnapshot({
  sessions,
  cwds: {},
  scrollOffsets: { s1: 120, s3: 0 },
  layout,
  activeSessionId: "s1",
});
assertEqual(snapScroll.sessions[0].scrollLinesFromBottom, 120, "scroll offset attaches from the offsets map");
assertEqual(snapScroll.sessions[1].scrollLinesFromBottom, undefined, "zero scroll offset is omitted");
assertEqual(
  buildSnapshot({ sessions, cwds: {}, layout, activeSessionId: "s1" }).sessions[0].scrollLinesFromBottom,
  undefined,
  "scroll offset omitted when no offsets map provided",
);

// --- parseSnapshot ---
const roundTrip = parseSnapshot(JSON.parse(JSON.stringify(snap)));
assertEqual(roundTrip?.sessions.length, 3, "JSON round trip preserves sessions");
assertEqual(roundTrip?.layout.titlebarOrder, ["session:s1", "session:s3"], "layout round trips");
assertEqual(parseSnapshot(null), null, "null discarded");
assertEqual(parseSnapshot("junk"), null, "non-object discarded");
assertEqual(parseSnapshot({ ...snap, version: 99 }), null, "unknown version discarded");
assertEqual(parseSnapshot({ ...snap, sessions: "nope" }), null, "malformed sessions discarded");
assertEqual(parseSnapshot({ ...snap, layout: { splitTabs: "x" } }), null, "malformed layout discarded");
assertEqual(
  parseSnapshot({ ...snap, sessions: [...snap.sessions, { id: 42 }] })?.sessions.length,
  3,
  "individual malformed session entries dropped",
);

assertEqual(
  parseSnapshot({ ...snap, sessions: [{ ...snap.sessions[0], persist: "yes" }] })?.sessions[0].persist,
  false,
  "non-boolean persist sanitized to false",
);

assertEqual(
  parseSnapshot({ ...snapScroll })?.sessions[0].scrollLinesFromBottom,
  120,
  "scroll offset round trips",
);
assertEqual(
  parseSnapshot({ ...snap, sessions: [{ ...snap.sessions[0], scrollLinesFromBottom: -5 }] })?.sessions[0].scrollLinesFromBottom,
  undefined,
  "negative scroll offset sanitized away",
);
assertEqual(
  parseSnapshot({ ...snap, sessions: [{ ...snap.sessions[0], scrollLinesFromBottom: 42.7 }] })?.sessions[0].scrollLinesFromBottom,
  42,
  "fractional scroll offset floored",
);

const mutLayout: SnapshotLayout = { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] };
const mutSnap = buildSnapshot({ sessions, cwds: {}, layout: mutLayout, activeSessionId: null });
mutLayout.splitTabs.push({});
mutLayout.titlebarOrder.push("session:x");
assertEqual(mutSnap.layout.splitTabs.length, 0, "snapshot layout is decoupled from caller mutation");
assertEqual(mutSnap.layout.titlebarOrder.length, 0, "snapshot titlebarOrder is decoupled from caller mutation");

const titled = buildSnapshot({
  sessions: [{ ...sessions[0], title: "deploy" }],
  cwds: {},
  layout,
  activeSessionId: "s1",
});
assertEqual(titled.sessions[0].title, "deploy", "a renamed tab is snapshotted");
assertEqual(parseSnapshot(titled)?.sessions[0].title, "deploy", "a tab name round trips");
assertEqual(
  buildSnapshot({ sessions: [sessions[0]], cwds: {}, layout, activeSessionId: "s1" }).sessions[0].title,
  undefined,
  "an unnamed tab carries no title",
);
assertEqual(
  parseSnapshot({ ...titled, sessions: [{ ...titled.sessions[0], title: 7 }] })?.sessions[0].title,
  undefined,
  "non-string title sanitized away",
);
});
