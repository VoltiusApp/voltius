import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  request: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  stop: vi.fn(),
  leave: vi.fn(),
  removeSession: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const state: { connections: Record<string, unknown> } = { connections: {} };
vi.mock("@/stores/teamSessionStore", () => ({
  useTeamSessionStore: (
    sel: (s: {
      connections: Record<string, unknown>;
      requestControl: typeof h.request;
      grantControl: typeof h.grant;
      revokeControl: typeof h.revoke;
      stopSharing: typeof h.stop;
      leaveSession: typeof h.leave;
    }) => unknown,
  ) =>
    sel({
      connections: state.connections,
      requestControl: h.request,
      grantControl: h.grant,
      revokeControl: h.revoke,
      stopSharing: h.stop,
      leaveSession: h.leave,
    }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (sel: (s: { removeSession: typeof h.removeSession }) => unknown) =>
    sel({ removeSession: h.removeSession }),
}));

import { MultiplayerBar } from "./MultiplayerBar";

const LOCAL_ID = "local1";

interface MpState {
  role: "host" | "guest";
  myUserId: string;
  controlHolder: string;
  controlRequester: string | null;
  ended: boolean;
  participants: Array<{ user_id: string; display_name: string }>;
}

function mk(overrides: Partial<MpState> = {}): MpState {
  return {
    role: "host",
    myUserId: "me",
    controlHolder: "",
    controlRequester: null,
    ended: false,
    participants: [],
    ...overrides,
  };
}

beforeEach(() => {
  state.connections = {};
  h.request.mockReset();
  h.grant.mockReset();
  h.revoke.mockReset();
  h.stop.mockReset().mockResolvedValue(undefined);
  h.leave.mockReset();
  h.removeSession.mockReset();
});
afterEach(() => cleanup());

test("no connection entry -> renders nothing", () => {
  state.connections = {};
  const { container } = render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(container.firstChild).toBeNull();
});

test("live indicator: ended shows ended text regardless of role", () => {
  state.connections[LOCAL_ID] = mk({ ended: true, role: "host" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.getByText("terminal.multiplayerBar.ended")).toBeTruthy();
  expect(screen.queryByText("terminal.multiplayerBar.sharing")).toBeNull();
});

test("live indicator: host not ended shows sharing", () => {
  state.connections[LOCAL_ID] = mk({ ended: false, role: "host" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.getByText("terminal.multiplayerBar.sharing")).toBeTruthy();
});

test("live indicator: participant not ended shows watching", () => {
  state.connections[LOCAL_ID] = mk({ ended: false, role: "guest" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.getByText("terminal.multiplayerBar.watching")).toBeTruthy();
});

test("participant, not control holder, not ended -> request-control button present; click requests control", () => {
  state.connections[LOCAL_ID] = mk({ role: "guest", myUserId: "me", controlHolder: "other" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  const btn = screen.getByText("terminal.multiplayerBar.requestControl");
  fireEvent.click(btn);
  expect(h.request).toHaveBeenCalledWith(LOCAL_ID);
});

test("host in the same state -> request-control button absent (gate on !isHost)", () => {
  state.connections[LOCAL_ID] = mk({ role: "host", myUserId: "me", controlHolder: "other" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.queryByText("terminal.multiplayerBar.requestControl")).toBeNull();
});

test("participant holds control -> youHaveControl shown, request button absent", () => {
  state.connections[LOCAL_ID] = mk({ role: "guest", myUserId: "me", controlHolder: "me" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.getByText("terminal.multiplayerBar.youHaveControl")).toBeTruthy();
  expect(screen.queryByText("terminal.multiplayerBar.requestControl")).toBeNull();
});

test("host + pending request -> grant click calls grantControl(id, requester); deny click calls revokeControl(id)", () => {
  state.connections[LOCAL_ID] = mk({ role: "host", myUserId: "me", controlRequester: "other" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  fireEvent.click(screen.getByText("terminal.multiplayerBar.grant"));
  expect(h.grant).toHaveBeenCalledWith(LOCAL_ID, "other");
  fireEvent.click(screen.getByText("terminal.multiplayerBar.deny"));
  expect(h.revoke).toHaveBeenCalledWith(LOCAL_ID);
});

test("host with controlRequester === myUserId -> pending block absent (hasPendingRequest false)", () => {
  state.connections[LOCAL_ID] = mk({ role: "host", myUserId: "me", controlRequester: "me" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.queryByText("terminal.multiplayerBar.grant")).toBeNull();
  expect(screen.queryByText("terminal.multiplayerBar.deny")).toBeNull();
});

test("host, not control holder, someone else holds control -> revoke button present; click calls revokeControl(id)", () => {
  state.connections[LOCAL_ID] = mk({ role: "host", myUserId: "me", controlHolder: "other" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  const btn = screen.getByText("terminal.multiplayerBar.revoke");
  fireEvent.click(btn);
  expect(h.revoke).toHaveBeenCalledWith(LOCAL_ID);
});

test("stop/leave routing: host click calls stopSharing(id) only", async () => {
  state.connections[LOCAL_ID] = mk({ role: "host", myUserId: "me" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  fireEvent.click(screen.getByText("terminal.multiplayerBar.stop"));
  await Promise.resolve();
  expect(h.stop).toHaveBeenCalledWith(LOCAL_ID);
  expect(h.leave).not.toHaveBeenCalled();
  expect(h.removeSession).not.toHaveBeenCalled();
});

test("stop/leave routing: participant click calls leaveSession(id) and removeSession(id)", async () => {
  state.connections[LOCAL_ID] = mk({ role: "guest", myUserId: "me" });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  fireEvent.click(screen.getByText("terminal.multiplayerBar.leave"));
  await Promise.resolve();
  expect(h.leave).toHaveBeenCalledWith(LOCAL_ID);
  expect(h.removeSession).toHaveBeenCalledWith(LOCAL_ID);
  expect(h.stop).not.toHaveBeenCalled();
});

test("ended hides control actions: host+pending+ended -> grant/deny/revoke absent; stop/leave still present", () => {
  state.connections[LOCAL_ID] = mk({
    role: "host",
    myUserId: "me",
    controlRequester: "other",
    controlHolder: "other",
    ended: true,
  });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.queryByText("terminal.multiplayerBar.grant")).toBeNull();
  expect(screen.queryByText("terminal.multiplayerBar.deny")).toBeNull();
  expect(screen.queryByText("terminal.multiplayerBar.revoke")).toBeNull();
  expect(screen.getByText("terminal.multiplayerBar.stop")).toBeTruthy();
});

test("ended hides control actions: participant+ended -> request button absent; leave still present", () => {
  state.connections[LOCAL_ID] = mk({ role: "guest", myUserId: "me", ended: true });
  render(<MultiplayerBar localSessionId={LOCAL_ID} />);
  expect(screen.queryByText("terminal.multiplayerBar.requestControl")).toBeNull();
  expect(screen.getByText("terminal.multiplayerBar.leave")).toBeTruthy();
});
