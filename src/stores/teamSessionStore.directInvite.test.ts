import { test, expect, vi, beforeEach } from "vitest";
import type { TeamMember } from "@/services/teamService";

const mp = vi.hoisted(() => ({
  listActiveSessions: vi.fn(async () => []),
  openWebSocket: vi.fn(() => ({ close: vi.fn(), requestControl: vi.fn(), grantControl: vi.fn(), revokeControl: vi.fn() })),
  drainSessionOutputBuffer: vi.fn(() => undefined),
  createDirectSession: vi.fn(async () => ({ sessionId: "sess-1", sessionKey: new Uint8Array(), sessionKeyBytes: new Uint8Array(32) })),
  inviteUserToSession: vi.fn(async () => {}),
}));
const svc = vi.hoisted(() => ({
  getServerUrlValue: vi.fn(async () => "https://s"),
  getJwtToken: vi.fn(async () => "jwt"),
  getMyUserId: vi.fn(async () => "u1"),
}));
vi.mock("@/services/multiplayerService", () => mp);
vi.mock("@/services/ssh", () => ({ sshSendInput: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", () => svc);
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { useTeamSessionStore } from "./teamSessionStore.ts";

// `satisfies` (not `: TeamMember`) keeps `handle` narrowed to `string` in the
// inferred type, so these fixtures also satisfy `InviteTarget` at call sites
// that pass them directly — TeamMember's `handle` is optional for a pre-035 server.
const member = (userId: string) => ({
  team_id: "t1", user_id: userId, invited_by_display_name: null, joined_at: "", handle: userId, public_key: "pk", role_ids: [],
}) satisfies TeamMember;

beforeEach(() => {
  Object.values(mp).forEach((f) => f.mockClear());
  useTeamSessionStore.setState({ activeSessions: [], connections: {} });
});

test("keeps the session key so a later invite can wrap it", async () => {
  await useTeamSessionStore.getState().startSharingDirect("local-1", "web-prod", [member("u1")]);
  expect(useTeamSessionStore.getState().connections["local-1"].sessionKeyBytes).toHaveLength(32);
});

test("wraps the retained key when inviting into a live session", async () => {
  await useTeamSessionStore.getState().startSharingDirect("local-1", "web-prod", [member("u1")]);
  await useTeamSessionStore.getState().inviteToActiveSession("local-1", member("u2"));
  expect(mp.inviteUserToSession).toHaveBeenCalledWith("sess-1", expect.objectContaining({ user_id: "u2" }), expect.any(Uint8Array));
});

test("throws when inviting into a session without a retained key (e.g. invite-link)", async () => {
  useTeamSessionStore.setState({
    connections: {
      "local-1": { multiplayerSessionId: "sess-1", role: "host", myUserId: "u1", participants: [], controlHolder: "", controlRequester: null, connection: {} as never },
    },
  });
  await expect(useTeamSessionStore.getState().inviteToActiveSession("local-1", member("u2"))).rejects.toThrow();
  expect(mp.inviteUserToSession).not.toHaveBeenCalled();
});
