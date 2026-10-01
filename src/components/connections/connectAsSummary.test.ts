import { test, expect } from "vitest";
import { connectAsSummary } from "./connectAsSummary";

const t = ((k: string, o?: Record<string, string>) => (o ? `${k}:${o.username}` : k)) as never;
const own = { id: "own", username: "alice", name: "Alice (laptop key)" };
const team = { id: "team", username: "deploy", name: "ops-deploy" };

test("summaries", () => {
  expect(connectAsSummary({ kind: "pick", identity: own }, (id: string) => id === "own", null, false, t)).toEqual({
    title: "Alice (laptop key)", subtitle: "connections.form.connectAsYours:alice", icon: "lucide:user-round-check", warn: false,
  });
  expect(connectAsSummary({ kind: "default", identity: team }, () => false, null, false, t).subtitle).toBe("connections.form.connectAsTeam:deploy");
  expect(connectAsSummary({ kind: "host" }, () => false, team, true, t)).toEqual({
    title: "ops-deploy", subtitle: "connections.form.connectAsHost", icon: "lucide:server", warn: false,
  });
  expect(connectAsSummary({ kind: "host" }, () => false, null, false, t).title).toBe("connections.form.connectAsAsk");
  expect(
    connectAsSummary({ kind: "unavailable", via: "pick", identityId: "x", reason: "missing", hasFallback: false }, () => false, null, false, t),
  ).toMatchObject({ title: "connections.form.connectAsUnavailable", warn: true });
});
