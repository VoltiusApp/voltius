import { test, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { resolvePeerName, memberLabel, avatarLabel, memberNamingSupported } from "@/services/peerName";
import type { TeamMember } from "@/services/teamService";

const m = (team_id: string, user_id: string, handle: string, member_name?: string | null): TeamMember => ({
  team_id, user_id, handle, member_name, invited_by_display_name: null, joined_at: "", public_key: "", role_ids: [],
});

test("team context uses that team's name only", () => {
  const rosters = { a: [m("a", "u", "swift-otter-1", null)], b: [m("b", "u", "swift-otter-1", "Jan")] };
  expect(resolvePeerName(rosters, "u", { teamId: "a" }).primary).toBe("@swift-otter-1");
  expect(resolvePeerName(rosters, "u", { teamId: "b" }).primary).toBe("Jan");
});

test("no context picks the lowest team id that has a name, deterministically", () => {
  const rosters = { z: [m("z", "u", "h", "Zed")], c: [m("c", "u", "h", "Cee")], a: [m("a", "u", "h", null)] };
  expect(resolvePeerName(rosters, "u").primary).toBe("Cee");
  expect(resolvePeerName({ c: rosters.c, z: rosters.z, a: rosters.a }, "u").primary).toBe("Cee");
});

test("unknown peer falls back to the payload handle, then a generic label", () => {
  expect(resolvePeerName({}, "x", { fallbackHandle: "brave-owl-2" })).toEqual({
    name: null, handle: "brave-owl-2", primary: "@brave-owl-2",
  });
  expect(resolvePeerName({}, "x").primary).toBe("common.memberFallback");
});

test("handle stays available beside a name", () => {
  const p = resolvePeerName({ a: [m("a", "u", "jnovak", "Jan Novák")] }, "u");
  expect(p).toEqual({ name: "Jan Novák", handle: "jnovak", primary: "Jan Novák" });
  expect(avatarLabel(p)).toBe("Jan Novák");
  expect(avatarLabel({ name: null, handle: "jnovak", primary: "@jnovak" })).toBe("jnovak");
});

test("memberLabel", () => {
  expect(memberLabel(m("a", "u", "h", "Jan"))).toBe("Jan");
  expect(memberLabel(m("a", "u", "h", null))).toBe("@h");
  expect(memberLabel(undefined)).toBe("?");
});

test("naming support is detected from the payload, not a version", () => {
  const old = { ...m("a", "u", "h"), member_name: undefined };
  delete (old as Partial<TeamMember>).member_name;
  expect(memberNamingSupported([old])).toBe(false);
  expect(memberNamingSupported([m("a", "u", "h", null)])).toBe(true);
  expect(memberNamingSupported(undefined)).toBe(false);
});
