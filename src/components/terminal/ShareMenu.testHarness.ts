import { vi } from "vitest";

// Shared fake-store scaffold for ShareMenu.test.tsx and ShareMenu.invitePeople.test.tsx.
// Mirrors the shape of useTeamStore / useTeamSessionStore so both suites break the
// same way (a type error, not a silent stale mock) when the real stores change.

export interface TeamState {
  teams: { id: string; name: string; owner_tier: string }[];
  loading: boolean;
  loadTeams: ReturnType<typeof vi.fn>;
  loadMembers: ReturnType<typeof vi.fn>;
  membersByTeam: Record<string, unknown[]>;
}

export interface MpState {
  connections: Record<string, unknown>;
  activeSessions: unknown[];
  startSharing: ReturnType<typeof vi.fn>;
  startSharingInviteLink: ReturnType<typeof vi.fn>;
  startSharingDirect: ReturnType<typeof vi.fn>;
  inviteToActiveSession: ReturnType<typeof vi.fn>;
  stopSharing: ReturnType<typeof vi.fn>;
  fetchActiveSessions: ReturnType<typeof vi.fn>;
}

export function makeTeamState(): TeamState {
  return {
    teams: [],
    loading: false,
    loadTeams: vi.fn(async () => {}),
    loadMembers: vi.fn(async () => {}),
    membersByTeam: {},
  };
}

export function makeMpState(): MpState {
  return {
    connections: {},
    activeSessions: [],
    startSharing: vi.fn(async () => "mp-1"),
    startSharingInviteLink: vi.fn(async () => ({ multiplayerSessionId: "mp-1", inviteToken: "tok-abc" })),
    startSharingDirect: vi.fn(async () => "mp-1"),
    inviteToActiveSession: vi.fn(async () => {}),
    stopSharing: vi.fn(async () => {}),
    fetchActiveSessions: vi.fn(async () => {}),
  };
}

/** Wraps a plain state object as a zustand-style selector hook (`useX(sel)` + `useX.getState()`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asStoreHook<S extends object>(state: S): any {
  const hook = (sel?: (s: S) => unknown) => (sel ? sel(state) : state);
  hook.getState = () => state;
  return hook;
}
