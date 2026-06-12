import {
  buildManifest,
  parseManifest,
  resolveRemoteSessions,
  pruneStale,
  MANIFEST_VERSION,
  type LiveSessionManifest,
} from "./liveSessionManifestCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

const now = new Date("2026-06-11T12:00:00Z");

// --- buildManifest ---
const built = buildManifest({
  snapshotSessions: [
    { id: "s1", type: "ssh", connectionId: "c1", connectionName: "web-01", persist: true, cwd: "/srv" },
    { id: "s2", type: "ssh", connectionId: "c2", connectionName: "db-01", persist: false },
    { id: "s3", type: "local", connectionId: "local", connectionName: "zsh", persist: false },
  ],
  opens: { s1: { openedAt: "2026-06-11T09:00:00Z" } },
  tombstones: { dead1: { closedAt: "2026-06-10T08:00:00Z" } },
  deviceId: "devA",
  deviceName: "laptop",
  now,
});
assertEqual(built.version, MANIFEST_VERSION, "manifest carries current version");
assertEqual(built.deviceId, "devA", "deviceId set");
assertEqual(built.deviceName, "laptop", "deviceName set");
assertEqual(built.updatedAt, "2026-06-11T12:00:00.000Z", "updatedAt is injected clock");
assertEqual(built.sessions.map((s) => s.id), ["s1"], "only persistent ssh listed");
assertEqual(built.sessions[0].openedAt, "2026-06-11T09:00:00.000Z", "openedAt from opens map");
assertEqual(built.sessions[0].cwd, "/srv", "cwd carried");
assertEqual(built.closedSessions, [{ id: "dead1", closedAt: "2026-06-10T08:00:00Z" }], "tombstones carried");

const noOpen = buildManifest({
  snapshotSessions: [{ id: "s9", type: "ssh", connectionId: "c9", connectionName: "x", persist: true }],
  opens: {},
  tombstones: {},
  deviceId: "devA",
  deviceName: "laptop",
  now,
});
assertEqual(noOpen.sessions[0].openedAt, "2026-06-11T12:00:00.000Z", "missing open backfilled with now");

// --- parseManifest ---
assertEqual(parseManifest(null), null, "null rejected");
assertEqual(parseManifest({ version: 1, deviceId: "d", sessions: [], closedSessions: [] }), null, "v1 rejected");
assertEqual(parseManifest({ version: 2, sessions: [] }), null, "missing deviceId rejected");

const parsed = parseManifest({
  version: 2,
  deviceId: "devB",
  deviceName: "desktop",
  updatedAt: "2026-06-11T10:00:00Z",
  sessions: [
    { id: "s1", connectionId: "c1", connectionName: "web-01", openedAt: "2026-06-11T10:00:00Z" },
    { id: 42, connectionId: "bad" },
  ],
  closedSessions: [{ id: "s7", closedAt: "2026-06-11T09:00:00Z" }, { id: 1 }],
});
assertEqual(parsed?.sessions.map((s) => s.id), ["s1"], "malformed session entries dropped");
assertEqual(parsed?.closedSessions.map((s) => s.id), ["s7"], "malformed tombstones dropped");
assertEqual(parsed?.deviceName, "desktop", "deviceName parsed");

// --- resolveRemoteSessions ---
const mkManifest = (
  deviceId: string,
  deviceName: string,
  updatedAt: string,
  sessions: { id: string; openedAt: string }[],
  closed: { id: string; closedAt: string }[] = [],
): LiveSessionManifest => ({
  version: MANIFEST_VERSION,
  deviceId,
  deviceName,
  updatedAt,
  sessions: sessions.map((s) => ({ ...s, connectionId: `conn-${s.id}`, connectionName: `name-${s.id}` })),
  closedSessions: closed,
});

// B lists s1 (which I also have open) and s2 (which I don't) → only s2 joinable.
const r1 = resolveRemoteSessions({
  manifests: [mkManifest("devB", "desktop", "2026-06-11T11:00:00Z", [
    { id: "s1", openedAt: "2026-06-11T10:00:00Z" },
    { id: "s2", openedAt: "2026-06-11T08:00:00Z" },
  ])],
  myDeviceId: "devA",
  myTombstones: {},
  myOpenSessionIds: ["s1"],
});
assertEqual(r1.joinable.map((j) => j.sessionId), ["s2"], "locally open sessions filtered out");
assertEqual(r1.joinable[0].deviceName, "desktop", "joinable carries device name");
assertEqual(r1.joinable[0].connectionId, "conn-s2", "joinable carries connection id");
assertEqual(r1.closedIds, [], "no tombstones, nothing closed");

// My own manifest is ignored.
const r2 = resolveRemoteSessions({
  manifests: [mkManifest("devA", "laptop", "2026-06-11T11:00:00Z", [{ id: "s5", openedAt: "2026-06-11T10:00:00Z" }])],
  myDeviceId: "devA",
  myTombstones: {},
  myOpenSessionIds: [],
});
assertEqual(r2.joinable, [], "own manifest never joinable");

// Any tombstone permanently suppresses a listing (ids are never reused).
const r3 = resolveRemoteSessions({
  manifests: [
    mkManifest("devB", "desktop", "2026-06-11T11:00:00Z", [{ id: "s1", openedAt: "2026-06-11T10:00:00Z" }]),
    mkManifest("devC", "tablet", "2026-06-11T11:00:00Z", [], [{ id: "s1", closedAt: "2026-06-01T00:00:00Z" }]),
  ],
  myDeviceId: "devA",
  myTombstones: {},
  myOpenSessionIds: [],
});
assertEqual(r3.joinable, [], "remote tombstone suppresses listing regardless of order");

const r4 = resolveRemoteSessions({
  manifests: [mkManifest("devB", "desktop", "2026-06-11T11:00:00Z", [{ id: "s1", openedAt: "2026-06-11T10:00:00Z" }])],
  myDeviceId: "devA",
  myTombstones: { s1: { closedAt: "2026-06-01T00:00:00Z" } },
  myOpenSessionIds: [],
});
assertEqual(r4.joinable, [], "my tombstone suppresses stale remote listing");

// Two participants list the same session → one card, from the freshest manifest.
const r5 = resolveRemoteSessions({
  manifests: [
    mkManifest("devB", "desktop", "2026-06-11T09:00:00Z", [{ id: "s1", openedAt: "2026-06-11T08:00:00Z" }]),
    mkManifest("devC", "tablet", "2026-06-11T11:00:00Z", [{ id: "s1", openedAt: "2026-06-11T10:00:00Z" }]),
  ],
  myDeviceId: "devA",
  myTombstones: {},
  myOpenSessionIds: [],
});
assertEqual(r5.joinable.map((j) => j.deviceId), ["devC"], "shared session deduped to freshest manifest");

// B killed s1 → my open tab must be torn down.
const r6 = resolveRemoteSessions({
  manifests: [mkManifest("devB", "desktop", "2026-06-11T11:00:00Z", [], [{ id: "s1", closedAt: "2026-06-11T10:30:00Z" }])],
  myDeviceId: "devA",
  myTombstones: {},
  myOpenSessionIds: ["s1"],
});
assertEqual(r6.closedIds, ["s1"], "remote tombstone closes my open session");
assertEqual(r6.joinable, [], "tombstoned session not joinable");

// My own tombstone does not produce closedIds (close path already handled it).
const r7 = resolveRemoteSessions({
  manifests: [],
  myDeviceId: "devA",
  myTombstones: { s1: { closedAt: "2026-06-11T10:30:00Z" } },
  myOpenSessionIds: ["s1"],
});
assertEqual(r7.closedIds, [], "own tombstone closes nothing");

// --- pruneStale ---
const pruned = pruneStale(
  {
    fresh: { openedAt: "2026-06-01T00:00:00Z" },
    ancient: { openedAt: "2026-03-01T00:00:00Z" },
  },
  now,
);
assertEqual(Object.keys(pruned), ["fresh"], "entries older than 60 days pruned");

const prunedTombs = pruneStale(
  {
    fresh: { closedAt: "2026-06-01T00:00:00Z" },
    ancient: { closedAt: "2026-03-01T00:00:00Z" },
  },
  now,
);
assertEqual(Object.keys(prunedTombs), ["fresh"], "tombstones older than 60 days pruned");

console.log("liveSessionManifest tests passed");
