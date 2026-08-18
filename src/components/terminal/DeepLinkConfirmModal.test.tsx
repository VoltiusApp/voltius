import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeepLinkConfirmModal } from "./DeepLinkConfirmModal";
import { useDeepLinkStore } from "@/stores/deepLinkStore";

let teamConnections: Record<string, { sessionKeyBytes?: Uint8Array }> = {};
let activeLocalSessionId: string | null = null;
let snippetEntries: { id: string; kind: string; name: string; author?: string; snippets: unknown[] }[] = [];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const fetchSnippetCatalogMock = vi.fn(async () => ({ entries: snippetEntries, fromCache: false }));
vi.mock("@/services/snippetCatalogFetch", () => ({
  fetchCatalog: () => fetchSnippetCatalogMock(),
}));

const installEntriesMock = vi.fn(async (..._args: unknown[]) => ({ imported: 1, errors: 0 }));
vi.mock("@/services/snippetCatalogInstall", () => ({
  installCatalogEntries: (...args: unknown[]) => installEntriesMock(...args),
}));

vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: { getState: () => ({ selectedVaultIds: ["team-a"], vaults: [{ id: "team-a", name: "Ops" }] }) },
}));

const joinMock = vi.fn(async (..._args: unknown[]) => "local-1");
vi.mock("@/services/teamSessionJoin", () => ({
  joinTeamSessionAndOpenTab: (...args: unknown[]) => joinMock(...args),
}));

const searchUsersMock = vi.fn(async (_q: string) => [] as { user_id: string; handle: string; is_teammate: boolean }[]);
vi.mock("@/services/teamService", () => ({
  searchUsers: (q: string) => searchUsersMock(q),
}));

const inviteMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/stores/teamSessionStore", () => ({
  useTeamSessionStore: { getState: () => ({ connections: teamConnections, inviteToActiveSession: inviteMock }) },
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ activeSessionId: activeLocalSessionId }) },
}));

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const intent = { route: "join" as const, sessionId: SESSION, token: "tok" };

beforeEach(() => {
  joinMock.mockClear().mockResolvedValue("local-1");
  searchUsersMock.mockClear().mockResolvedValue([]);
  inviteMock.mockClear();
  teamConnections = {};
  activeLocalSessionId = null;
  snippetEntries = [];
  fetchSnippetCatalogMock.mockClear();
  installEntriesMock.mockClear().mockResolvedValue({ imported: 1, errors: 0 });
  useDeepLinkStore.setState({ ready: true, queue: [], prompt: null });
});

afterEach(() => cleanup());

test("renders nothing without a prompt", () => {
  const { container } = render(<DeepLinkConfirmModal />);
  expect(container.innerHTML).toBe("");
});

test("does not join until the user confirms", () => {
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  expect(screen.getByText("terminal.share.deepLinkJoinTitle")).toBeTruthy();
  expect(joinMock).not.toHaveBeenCalled();
});

test("confirming joins with the link's session id and token", async () => {
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  await userEvent.click(screen.getByText("terminal.share.deepLinkJoinAction"));
  await waitFor(() =>
    expect(joinMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION, inviteToken: "tok" }),
    ),
  );
  await waitFor(() => expect(useDeepLinkStore.getState().prompt).toBeNull());
});

test("cancelling clears the prompt without joining", async () => {
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  await userEvent.click(screen.getByText("common.action.cancel"));
  expect(joinMock).not.toHaveBeenCalled();
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

test("a failed join shows the error and keeps the sheet open", async () => {
  joinMock.mockRejectedValue(new Error("nope"));
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  await userEvent.click(screen.getByText("terminal.share.deepLinkJoinAction"));
  await waitFor(() =>
    expect(screen.getByText("terminal.share.deepLinkJoinFailed")).toBeTruthy(),
  );
  expect(useDeepLinkStore.getState().prompt).not.toBeNull();
});

test("a second click while the first join is in flight does not join twice", async () => {
  let resolveJoin!: (v: string) => void;
  joinMock.mockReturnValue(
    new Promise<string>((resolve) => {
      resolveJoin = resolve;
    }),
  );
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  const button = screen.getByText("terminal.share.deepLinkJoinAction");
  await userEvent.click(button);
  await userEvent.click(button);
  expect(joinMock).toHaveBeenCalledTimes(1);
  resolveJoin("local-1");
});

test("a stale error is cleared when a new link is prompted", async () => {
  joinMock.mockRejectedValue(new Error("nope"));
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkConfirmModal />);
  await userEvent.click(screen.getByText("terminal.share.deepLinkJoinAction"));
  await waitFor(() =>
    expect(screen.getByText("terminal.share.deepLinkJoinFailed")).toBeTruthy(),
  );
  const other = { route: "join" as const, sessionId: "11111111-2222-3333-4444-555555555555", token: "tok2" };
  useDeepLinkStore.setState({ prompt: other });
  await waitFor(() =>
    expect(screen.queryByText("terminal.share.deepLinkJoinFailed")).toBeNull(),
  );
});

test("an invite sheet names the handle and invites the resolved user", async () => {
  searchUsersMock.mockResolvedValue([{ user_id: "u1", handle: "kevin-p", is_teammate: false }]);
  activeLocalSessionId = "local-1";
  teamConnections = { "local-1": { sessionKeyBytes: new Uint8Array(32) } };
  useDeepLinkStore.setState({ prompt: { route: "invite", handle: "kevin-p" } });
  render(<DeepLinkConfirmModal />);
  await waitFor(() =>
    expect((screen.getByText("terminal.share.deepLinkInviteAction").closest("button") as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(screen.getByText("terminal.share.deepLinkInviteAction"));
  await waitFor(() =>
    expect(inviteMock).toHaveBeenCalledWith("local-1", expect.objectContaining({ user_id: "u1", handle: "kevin-p" })),
  );
});

test("an invite link whose handle only fuzzily matches invites nobody", async () => {
  searchUsersMock.mockResolvedValue([{ user_id: "u1", handle: "kevin-porter", is_teammate: false }]);
  activeLocalSessionId = "local-1";
  teamConnections = { "local-1": { sessionKeyBytes: new Uint8Array(32) } };
  useDeepLinkStore.setState({ prompt: { route: "invite", handle: "kevin-p" } });
  render(<DeepLinkConfirmModal />);
  await waitFor(() => expect(screen.getByText("terminal.share.deepLinkInviteUnknownUser")).toBeTruthy());
  await userEvent.click(screen.getByText("terminal.share.deepLinkInviteAction"));
  expect(inviteMock).not.toHaveBeenCalled();
});

test("an invite link with no shareable session names the handle but cannot be accepted", async () => {
  searchUsersMock.mockResolvedValue([{ user_id: "u1", handle: "kevin-p", is_teammate: false }]);
  activeLocalSessionId = null;
  teamConnections = {};
  useDeepLinkStore.setState({ prompt: { route: "invite", handle: "kevin-p" } });
  render(<DeepLinkConfirmModal />);
  await waitFor(() => expect(screen.getByText("terminal.share.deepLinkInviteNoActiveSession")).toBeTruthy());
  await userEvent.click(screen.getByText("terminal.share.deepLinkInviteAction"));
  expect(inviteMock).not.toHaveBeenCalled();
});

test("a snippet-install sheet names the entry and its destination vault before installing", async () => {
  snippetEntries = [{ id: "docker-cleanup", kind: "pack", name: "Docker cleanup", author: "kevin", snippets: [{}, {}] }];
  useDeepLinkStore.setState({ prompt: { route: "snippet-install", entryId: "docker-cleanup" } });
  render(<DeepLinkConfirmModal />);
  await waitFor(() => expect(screen.getByText("snippets.deepLinkInstall.summary")).toBeTruthy());
  expect(screen.getByText("snippets.deepLinkInstall.destination")).toBeTruthy();
  expect(installEntriesMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("snippets.deepLinkInstall.action"));
  await waitFor(() =>
    expect(installEntriesMock).toHaveBeenCalledWith(
      [expect.objectContaining({ entry: expect.objectContaining({ id: "docker-cleanup" }) })],
      "team-a",
    ),
  );
});

test("a snippet-install link naming an entry the catalogue does not list cannot be accepted", async () => {
  snippetEntries = [];
  useDeepLinkStore.setState({ prompt: { route: "snippet-install", entryId: "docker-cleanup" } });
  render(<DeepLinkConfirmModal />);
  await waitFor(() => expect(screen.getByText("snippets.deepLinkInstall.failed")).toBeTruthy());
  await userEvent.click(screen.getByText("snippets.deepLinkInstall.action"));
  expect(installEntriesMock).not.toHaveBeenCalled();
});
