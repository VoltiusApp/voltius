import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  notify: vi.fn(async () => {}),
  getMyUserId: vi.fn(async () => "me"),
  enabled: { value: true },
}));
vi.mock("@/services/connectionPresence", () => ({ notifyConnectionUsage: h.notify }));
vi.mock("@/services/teamService", () => ({ getMyUserId: h.getMyUserId }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  useToggle: () => [h.enabled.value, () => {}],
}));

import { createUsageAnnouncer, useConnectionPresenceBroadcast } from "./useConnectionPresenceBroadcast";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPresenceStore } from "@/stores/connectionPresenceStore";

function Harness() {
  useConnectionPresenceBroadcast();
  return null;
}

const sess = (o: Partial<{ connectionId: string; type: string; status: string }>) =>
  ({
    id: o.connectionId ?? "s",
    connectionId: o.connectionId ?? "c1",
    type: o.type ?? "ssh",
    status: o.status ?? "connected",
    connectionName: "",
  }) as never;
const c = (id: string, vault_id?: string) => ({ id, vault_id }) as never;

const notifyCalls = () => h.notify.mock.calls as unknown as [string, boolean][];
const startCallsFor = (id: string) =>
  notifyCalls().filter((args) => args[0] === id && args[1] === true).length;
const stopCallsFor = (id: string) =>
  notifyCalls().filter((args) => args[0] === id && args[1] === false).length;

beforeEach(() => {
  h.notify.mockReset().mockResolvedValue(undefined);
  h.getMyUserId.mockReset().mockResolvedValue("me");
  h.enabled.value = true;
  useSessionStore.setState({ sessions: [] } as never);
  useConnectionStore.setState({ connections: [], teamConnections: {} } as never);
  useConnectionPresenceStore.setState({ myUserId: null } as never);
});
afterEach(() => cleanup());

test("broadcasts start for a team-vault ssh session on mount", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));
});

test("does not broadcast for personal vault", async () => {
  useConnectionStore.setState({ connections: [c("c1", "personal")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("does not broadcast when vault_id absent", async () => {
  useConnectionStore.setState({ connections: [c("c1", undefined)], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("ignores non-ssh/serial session types", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1", type: "local" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("ignores multiplayer session type", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1", type: "multiplayer" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("serial session in team vault broadcasts", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({
    sessions: [sess({ connectionId: "c1", type: "serial", status: "connected" })],
  } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));
});

test("ignores sessions not connected/connecting (closed)", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1", status: "closed" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("broadcasts for connecting status", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1", status: "connecting" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));
});

test("disabled toggle broadcasts nothing", async () => {
  h.enabled.value = false;
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(0);
});

test("resolves connection from teamConnections too", async () => {
  useConnectionStore.setState({
    connections: [],
    teamConnections: { "team-1": [c("c1", "team-1")] },
  } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));
});

test("stop fires when the last session for a connection ends", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));

  act(() => {
    useSessionStore.setState({ sessions: [] } as never);
  });
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", false));
});

test("only first start / last stop per connection (union semantics)", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({
    sessions: [
      sess({ connectionId: "c1" }),
      { id: "s2", connectionId: "c1", type: "ssh", status: "connected", connectionName: "" } as never,
    ],
  } as never);
  render(<Harness />);
  await waitFor(() => expect(startCallsFor("c1")).toBe(1));

  // remove one session, the other for c1 remains open -> no stop
  act(() => {
    useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(stopCallsFor("c1")).toBe(0);

  // remove the last session for c1 -> stop fires
  act(() => {
    useSessionStore.setState({ sessions: [] } as never);
  });
  await waitFor(() => expect(stopCallsFor("c1")).toBe(1));
});

test("unmount stops all broadcasting connections", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledWith("c1", true));

  cleanup();
  expect(h.notify).toHaveBeenCalledWith("c1", false);
});

test("primes myUserId from getMyUserId on mount", async () => {
  render(<Harness />);
  await waitFor(() => expect(useConnectionPresenceStore.getState().myUserId).toBe("me"));
});

const reopenStream = () => act(() => { useConnectionPresenceStore.getState().markStreamOpen(); });
const twoTeamConnections = () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1"), c("c2", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({
    sessions: [sess({ connectionId: "c1" }), { id: "s2", connectionId: "c2", type: "ssh", status: "connected", connectionName: "" } as never],
  } as never);
};

test("a reopened stream re-announces every connection still in use (#791)", async () => {
  twoTeamConnections();
  render(<Harness />);
  await waitFor(() => expect(startCallsFor("c2")).toBe(1));
  expect(startCallsFor("c1")).toBe(1);

  reopenStream();
  await waitFor(() => expect(startCallsFor("c1")).toBe(2));
  expect(startCallsFor("c2")).toBe(2);
});

test("an unchanged session list sends nothing more", async () => {
  twoTeamConnections();
  render(<Harness />);
  await waitFor(() => expect(h.notify).toHaveBeenCalledTimes(2));

  act(() => { useSessionStore.setState({ sessions: [...useSessionStore.getState().sessions] } as never); });
  await new Promise((r) => setTimeout(r, 0));
  expect(h.notify).toHaveBeenCalledTimes(2);
});

test("a failed announcement is sent again once the stream reopens, then not repeated", async () => {
  h.notify.mockRejectedValueOnce(new Error("HTTP 503"));
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(startCallsFor("c1")).toBe(1));

  reopenStream();
  await waitFor(() => expect(startCallsFor("c1")).toBe(2));
  act(() => { useSessionStore.setState({ sessions: [...useSessionStore.getState().sessions] } as never); });
  await new Promise((r) => setTimeout(r, 0));
  expect(startCallsFor("c1")).toBe(2);
});

test("a stop the server never got is sent again once the stream reopens", async () => {
  useConnectionStore.setState({ connections: [c("c1", "team-1")], teamConnections: {} } as never);
  useSessionStore.setState({ sessions: [sess({ connectionId: "c1" })] } as never);
  render(<Harness />);
  await waitFor(() => expect(startCallsFor("c1")).toBe(1));

  h.notify.mockRejectedValueOnce(new Error("net"));
  act(() => { useSessionStore.setState({ sessions: [] } as never); });
  await waitFor(() => expect(stopCallsFor("c1")).toBe(1));

  reopenStream();
  await waitFor(() => expect(stopCallsFor("c1")).toBe(2));
  expect(startCallsFor("c1")).toBe(1);
});

test("a reopened stream announces nothing while team presence is off", async () => {
  h.enabled.value = false;
  twoTeamConnections();
  render(<Harness />);
  reopenStream();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.notify).not.toHaveBeenCalled();
});

test("a failed announcement is retried after a backoff without waiting for the stream", async () => {
  const sends: [string, boolean][] = [];
  let fail = true;
  const notify = vi.fn(async (id: string, inUse: boolean) => {
    sends.push([id, inUse]);
    if (fail) throw new Error("HTTP 500");
  });
  const timers: { fn: () => void; ms: number }[] = [];
  const announcer = createUsageAnnouncer(notify, (failures) => failures * 1000, (fn, ms) => { timers.push({ fn, ms }); return () => {}; });

  announcer.reconcile(new Set(["c1"]));
  await Promise.resolve(); await Promise.resolve();
  expect(timers.map((t) => t.ms)).toEqual([1000]);

  timers[0].fn();
  await Promise.resolve(); await Promise.resolve();
  expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);

  fail = false;
  timers[1].fn();
  await Promise.resolve(); await Promise.resolve();
  expect(sends).toEqual([["c1", true], ["c1", true], ["c1", true]]);
  expect(timers).toHaveLength(2);
});

test("a session closed while its start is still in flight is stopped once the start lands", async () => {
  let land = () => {};
  const notify = vi.fn((_id: string, inUse: boolean) =>
    inUse ? new Promise<void>((r) => { land = r; }) : Promise.resolve());
  const announcer = createUsageAnnouncer(notify);

  announcer.reconcile(new Set(["c1"]));
  announcer.reconcile(new Set());
  expect(notify).toHaveBeenCalledTimes(1);

  land();
  await Promise.resolve(); await Promise.resolve();
  expect(notify.mock.calls).toEqual([["c1", true], ["c1", false]]);
});
