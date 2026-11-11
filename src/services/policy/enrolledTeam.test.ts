// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/clientHeaders", () => ({ clientVersion: mocks.version }));
vi.mock("@/services/enrollment/enrollmentPolicy", () => ({ fetchEnrolledPolicy: mocks.fetch }));

import { resetEnrolledTeamSync, startEnrolledTeamSync, syncEnrolledTeam, syncEnrolledTeamOnRevision } from "./enrolledTeam";
import type { EnrolledFetch } from "@/services/enrollment/enrollmentPolicy";
import { useEnrolledTeamStore, type EnrolledTeamEntry } from "@/stores/enrolledTeamStore";
import { usePolicyStore, type PolicyIssue } from "@/stores/policyStore";
import { DEVICE_SCOPED_STORAGE_KEYS } from "@/stores/persistedAccountUiState";
import { ENROLL_ID as ID_A, ENROLL_SECRET as SECRET, ENROLL_SERVER as SERVER, echoTeamDoc, enrollmentTokenText as tokenText, resetPolicy, withPolicy, withTeamPolicy } from "@/test/policy";
import { LOCK_ACTION_KEY as ACTION } from "@/services/lockPolicy";

const ID_B = "b".repeat(32);
const machine = (id = ID_A, extra: Record<string, unknown> = {}) => ({ "enrollment.token": tokenText(id), ...extra });

const teamReply = (id: string, name: string, revision: number, policy: Record<string, unknown> | null = { [ACTION]: "vault" }): EnrolledFetch => ({
  kind: "team",
  team: { id, name, policy: policy && { version: 1, policy }, policyRevision: revision },
});

const FRESH_MS = 5 * 60_000;
const elapse = (ms = FRESH_MS) => vi.setSystemTime(Date.now() + ms);

const entry = (): EnrolledTeamEntry | null => useEnrolledTeamStore.getState().entry;

const seed = async (reply = teamReply("t1", "Acme", 3)) => {
  mocks.fetch.mockResolvedValueOnce(reply);
  await syncEnrolledTeam(machine());
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  resetEnrolledTeamSync();
  localStorage.clear();
  resetPolicy();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(echoTeamDoc);
  mocks.fetch.mockReset();
  mocks.version.mockResolvedValue("1.0.0");
  useEnrolledTeamStore.getState().setEntry(null);
});

describe("syncEnrolledTeam", () => {
  it("caches the enrolling team's checked policy", async () => {
    await seed();
    expect(mocks.fetch).toHaveBeenCalledWith({ serverUrl: SERVER, id: ID_A, secret: SECRET }, null);
    expect(entry()).toEqual({
      tokenId: ID_A,
      server: SERVER,
      teamId: "t1",
      teamName: "Acme",
      revision: 3,
      clientVersion: "1.0.0",
      layer: { policy: { [ACTION]: "vault" }, teams: { [ACTION]: ["Acme"] }, issues: [] },
    });
  });

  it("asks with the cached revision for the same token", async () => {
    await seed();
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "keep" });
    await syncEnrolledTeam(machine());
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), 3);
  });

  it("after an upgrade, asks without a revision and re-checks the doc", async () => {
    await seed();
    resetEnrolledTeamSync();
    mocks.version.mockResolvedValue("1.1.0");
    await seed(teamReply("t1", "Acme", 3, { "ssh.agentForwarding": false }));
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), null);
    expect(entry()).toMatchObject({ revision: 3, clientVersion: "1.1.0", layer: { policy: { "ssh.agentForwarding": false } } });
  });

  it("an entry cached before versions were stored is re-checked", async () => {
    await seed();
    const { clientVersion: _, ...legacy } = entry()!;
    useEnrolledTeamStore.getState().setEntry(legacy as EnrolledTeamEntry);
    resetEnrolledTeamSync();
    await seed();
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), null);
    expect(entry()?.clientVersion).toBe("1.0.0");
  });

  it("prefixes the check's issues with the team name", async () => {
    mocks.invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const checked = await echoTeamDoc(cmd, args);
      return checked && { ...checked, issues: [{ kind: "unknownKey", layer: "policy", key: "x", message: "unknown key" }] };
    });
    await seed();
    expect(entry()?.layer.issues).toEqual([{ kind: "unknownKey", layer: "policy", key: "x", message: "Acme: unknown key" }]);
  });

  it("no token clears the entry", async () => {
    await seed();
    await syncEnrolledTeam({});
    expect(entry()).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("a token removed and restored within five minutes fetches again", async () => {
    await seed();
    await syncEnrolledTeam({});
    await seed();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), null);
    expect(entry()).toMatchObject({ teamId: "t1" });
  });

  it("an unparseable token clears the entry", async () => {
    await seed();
    await syncEnrolledTeam({ "enrollment.token": "not-a-token" });
    expect(entry()).toBeNull();
  });

  it("a server the policy blocks is never asked and the entry is cleared", async () => {
    await seed();
    const pinned = { "server.url": "https://pinned.example", "server.allowOther": false };
    usePolicyStore.setState({ machine: { policy: pinned, defaults: {} } });
    await syncEnrolledTeam(machine(ID_A, pinned));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(entry()).toBeNull();
  });

  it("a new token replaces the entry with another team", async () => {
    await seed();
    mocks.fetch.mockResolvedValueOnce(teamReply("t2", "Globex", 9, { "ssh.agentForwarding": false }));
    await syncEnrolledTeam(machine(ID_B));
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_B }), null);
    expect(entry()).toMatchObject({ tokenId: ID_B, teamId: "t2", teamName: "Globex", revision: 9 });
    expect(entry()?.layer.policy).toEqual({ "ssh.agentForwarding": false });
  });

  it("unchanged keeps the doc and takes the new name", async () => {
    await seed();
    const before = entry()!;
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "unchanged", name: "Acme Corp" });
    await syncEnrolledTeam(machine());
    expect(entry()).toMatchObject({ teamId: "t1", teamName: "Acme Corp", revision: 3 });
    expect(entry()?.layer.policy).toEqual(before.layer.policy);
    expect(entry()?.layer.teams).toEqual({ [ACTION]: ["Acme Corp"] });
  });

  it("unchanged under the same name leaves the entry untouched", async () => {
    await seed();
    const before = entry();
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "unchanged", name: "Acme" });
    await syncEnrolledTeam(machine());
    expect(entry()).toBe(before);
  });

  it("drop clears the entry", async () => {
    await seed();
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "drop" });
    await syncEnrolledTeam(machine());
    expect(entry()).toBeNull();
  });

  it("keep keeps the entry", async () => {
    await seed();
    const before = entry();
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "keep" });
    await syncEnrolledTeam(machine());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(entry()).toBe(before);
  });

  it("a token change clears the old entry even when the first fetch fails", async () => {
    await seed();
    mocks.fetch.mockResolvedValueOnce({ kind: "keep" });
    await syncEnrolledTeam(machine(ID_B));
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_B }), null);
    expect(entry()).toBeNull();
  });

  it("a team without a policy is cached as an empty layer", async () => {
    await seed(teamReply("t1", "Acme", 5, null));
    expect(entry()).toMatchObject({ teamId: "t1", revision: 5, layer: { policy: {}, teams: {}, issues: [] } });
    expect(mocks.invoke).not.toHaveBeenCalledWith("policy_check_team_doc", expect.anything());
  });

  it("the latest of two overlapping syncs wins", async () => {
    let releaseFirst!: (r: EnrolledFetch) => void;
    mocks.fetch
      .mockReturnValueOnce(new Promise<EnrolledFetch>((r) => (releaseFirst = r)))
      .mockResolvedValueOnce(teamReply("t2", "Globex", 2));
    const first = syncEnrolledTeam(machine(ID_A));
    await syncEnrolledTeam(machine(ID_B));
    releaseFirst(teamReply("t1", "Acme", 1));
    await first;
    expect(entry()).toMatchObject({ tokenId: ID_B, teamId: "t2" });
  });
});

describe("syncEnrolledTeamOnRevision", () => {
  beforeEach(async () => {
    withPolicy(machine());
    await seed();
  });

  it("a newer revision on the account's copy fetches at once", async () => {
    mocks.fetch.mockResolvedValueOnce(teamReply("t1", "Acme", 4, { "ssh.agentForwarding": false }));
    await syncEnrolledTeamOnRevision([{ id: "t1", policy_revision: 4 }]);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), 3);
    expect(entry()).toMatchObject({ revision: 4, layer: { policy: { "ssh.agentForwarding": false } } });
  });

  it.each([
    ["the same revision", [{ id: "t1", policy_revision: 3 }]],
    ["another team", [{ id: "t2", policy_revision: 9 }]],
    ["no revision", [{ id: "t1" }]],
  ])("%s waits for the usual sync", async (_, teams) => {
    await syncEnrolledTeamOnRevision(teams);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

it("the cache is device-scoped and persisted under its own key", async () => {
  expect(DEVICE_SCOPED_STORAGE_KEYS).toContain("voltius-enrolled-team");
  await seed();
  expect(JSON.parse(localStorage.getItem("voltius-enrolled-team")!).state.entry.teamId).toBe("t1");
});

describe("startEnrolledTeamSync", () => {
  let visibility: DocumentVisibilityState = "visible";

  beforeAll(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    startEnrolledTeamSync();
    startEnrolledTeamSync();
    visibility = "visible";
    withPolicy(machine());
    mocks.fetch.mockResolvedValue({ kind: "keep" });
  });

  it("syncs every 15 minutes while visible", async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the tick while hidden", async () => {
    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  const loadMachine = (policy: Record<string, unknown>, issues: PolicyIssue[] = []) =>
    mocks.invoke.mockImplementation(async (cmd: string, args?: unknown) =>
      cmd === "policy_load" ? { doc: { policy, defaults: {} }, issues } : echoTeamDoc(cmd, args),
    );
  const loadSettled = async () => {
    await usePolicyStore.getState().load();
    await vi.advanceTimersByTimeAsync(0);
  };
  const loadTwice = async () => {
    await usePolicyStore.getState().load();
    await loadSettled();
  };

  it("after a drop, loads within five minutes do not fetch again", async () => {
    loadMachine(machine());
    await seed();
    elapse();
    mocks.fetch.mockResolvedValueOnce({ kind: "drop" });
    await syncEnrolledTeam(machine());
    expect(entry()).toBeNull();
    await loadTwice();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    elapse();
    await loadSettled();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("after a failed fetch with no entry, loads within five minutes do not fetch again", async () => {
    loadMachine(machine());
    await syncEnrolledTeam(machine());
    expect(entry()).toBeNull();
    await loadTwice();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("concurrent syncs for one token fetch once", async () => {
    await Promise.all([syncEnrolledTeam(machine()), syncEnrolledTeam(machine())]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("a token swap inside the window clears the old entry before its fetch returns", async () => {
    await seed();
    mocks.fetch.mockReturnValueOnce(new Promise<EnrolledFetch>(() => {}));
    void syncEnrolledTeam(machine(ID_B));
    expect(entry()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_B }), null);
  });

  it("loads within five minutes of a fetch for the same token do not fetch again", async () => {
    loadMachine(machine());
    mocks.fetch.mockResolvedValueOnce(teamReply("t1", "Acme", 3));
    await syncEnrolledTeam(machine());
    await usePolicyStore.getState().load();
    elapse(FRESH_MS - 1);
    await loadSettled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    elapse(1);
    await loadSettled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_A }), 3);
  });

  it("a token change fetches at once", async () => {
    mocks.fetch.mockResolvedValueOnce(teamReply("t1", "Acme", 3));
    await syncEnrolledTeam(machine());
    loadMachine(machine(ID_B));
    await loadSettled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_B }), null);
  });

  it("syncs after a machine policy load", async () => {
    loadMachine(machine(ID_B));
    await loadSettled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ id: ID_B }), null);
  });

  describe("before the machine policy has loaded", () => {
    beforeEach(async () => {
      usePolicyStore.setState({ machine: { policy: {}, defaults: {} }, machineLoaded: false });
      await seed();
    });

    it("a team-layer change after a failed load keeps the entry", async () => {
      mocks.invoke.mockRejectedValue(new Error("ipc down"));
      await usePolicyStore.getState().load();
      withTeamPolicy({ "ssh.agentForwarding": false });
      await vi.advanceTimersByTimeAsync(0);
      expect(entry()).toMatchObject({ teamId: "t1" });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it("the tick waits for the first load", async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(entry()).toMatchObject({ teamId: "t1" });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it("a load that could not read the machine file keeps the entry", async () => {
      loadMachine({}, [{ kind: "file", layer: null, key: null, message: "unreadable" }]);
      await loadSettled();
      expect(entry()).toMatchObject({ teamId: "t1" });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it("a successful load without a token clears the entry", async () => {
      loadMachine({});
      await loadSettled();
      expect(entry()).toBeNull();
    });
  });
});
