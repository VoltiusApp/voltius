import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, opts?: { returnObjects?: boolean }) => (opts?.returnObjects ? [] : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

// vi.mock factories run lazily (when the mocked module is first resolved), unlike
// vi.hoisted callbacks — so, unlike vi.hoisted, they can safely call into a normally
// imported helper module. State is retrieved back via useX.getState() below.
vi.mock("@/stores/teamStore", async () => {
  const { makeTeamState, asStoreHook } = await import("./ShareMenu.testHarness");
  return { useTeamStore: asStoreHook(makeTeamState()) };
});
vi.mock("@/stores/teamSessionStore", async () => {
  const { makeMpState, asStoreHook } = await import("./ShareMenu.testHarness");
  return { useTeamSessionStore: asStoreHook(makeMpState()) };
});
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn(async (_text: string) => {}) }));

import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { writeClipboard as writeClipboardImport } from "@/utils/clipboard";
import { makeMpState, type MpState } from "./ShareMenu.testHarness";
import { ShareMenu } from "./ShareMenu";

const teamState = useTeamStore.getState();
const mpState = useTeamSessionStore.getState() as unknown as MpState;
const writeClipboard = vi.mocked(writeClipboardImport);

// Mirrors the real store: startSharingInviteLink writes `connections` before it
// resolves, so `activeMp` exists (and isSharing flips true) by the time ShareMenu
// re-renders — same ordering that made autoCopied miss the field.
function resetMpState() {
  Object.assign(mpState, makeMpState());
  mpState.startSharingInviteLink = vi.fn(async (localSessionId: string) => {
    mpState.connections = {
      ...mpState.connections,
      [localSessionId]: { multiplayerSessionId: "mp-1", ended: false, participants: [], myUserId: "me", controlHolder: "me" },
    };
    return { multiplayerSessionId: "mp-1", inviteToken: "tok-abc" };
  });
}

beforeEach(() => {
  teamState.teams = [];
  teamState.loading = false;
  teamState.loadTeams = vi.fn(async () => {});
  teamState.loadMembers = vi.fn(async () => {});
  teamState.membersByTeam = {};
  resetMpState();
  writeClipboard.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

function renderMenu(overrides: { tier?: "pro" | "teams" | "business"; connectionVaultId?: string } = {}) {
  const anchorRef = createRef<HTMLButtonElement>();
  // Default: tier="pro" with a personal (non-qualifying) vault means People and Link
  // are the only tabs (no qualifying vault for Team), with People selected by default.
  return render(
    <ShareMenu
      anchorRef={anchorRef}
      open
      onClose={() => {}}
      activeSessionId="local-1"
      connectionName="Prod DB"
      connectionVaultId={overrides.connectionVaultId ?? "personal"}
      isLoggedIn
      tier={overrides.tier ?? "pro"}
      onSignIn={() => {}}
      onUpgrade={() => {}}
    />,
  );
}

async function generateInviteLink() {
  renderMenu();
  // People is the default tab now; switch to Link before generating.
  fireEvent.click(screen.getByText("terminal.share.tabInviteLink"));
  fireEvent.click(screen.getByText("terminal.share.generateInviteLink"));
  await waitFor(() => expect(mpState.startSharingInviteLink).toHaveBeenCalled());
}

test("generating an invite link copies the code to the clipboard and shows the copied state", async () => {
  await generateInviteLink();

  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("https://voltius.app/open#join?s=mp-1&t=tok-abc"));
  await waitFor(() => expect(screen.getByText("terminal.shared.copied")).toBeTruthy());

  const input = screen.getByDisplayValue("https://voltius.app/open#join?s=mp-1&t=tok-abc") as HTMLInputElement;
  expect(input.value).toBe("https://voltius.app/open#join?s=mp-1&t=tok-abc");
});

test("with only the host in participants, the waiting line renders and no lone self-chip appears", () => {
  mpState.connections = {
    "local-1": { multiplayerSessionId: "mp-1", ended: false, participants: [{ user_id: "me", handle: "Me" }], myUserId: "me", controlHolder: "me" },
  };
  renderMenu();

  expect(screen.getByText("terminal.share.waitingForGuests")).toBeTruthy();
  expect(screen.queryByText("Me")).toBeNull();
});

test("with a guest present, the chips render and the waiting line does not", () => {
  mpState.connections = {
    "local-1": {
      multiplayerSessionId: "mp-1",
      ended: false,
      participants: [{ user_id: "me", handle: "Me" }, { user_id: "guest-1", handle: "Guest" }],
      myUserId: "me",
      controlHolder: "me",
    },
  };
  renderMenu();

  expect(screen.getByText("Guest")).toBeTruthy();
  expect(screen.queryByText("terminal.share.waitingForGuests")).toBeNull();
});

test("a rejecting writeClipboard leaves the share successful and the field uncopied", async () => {
  writeClipboard.mockRejectedValue(new Error("denied"));

  await generateInviteLink();

  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("https://voltius.app/open#join?s=mp-1&t=tok-abc"));
  // Share itself still succeeded: the code field is rendered, no error surfaced.
  expect(screen.getByDisplayValue("https://voltius.app/open#join?s=mp-1&t=tok-abc")).toBeTruthy();
  expect(screen.queryByText("terminal.share.failedToGenerateLink")).toBeNull();
  expect(screen.getByText("common.action.copy")).toBeTruthy();
  expect(screen.queryByText("terminal.shared.copied")).toBeNull();
});

// ─── Tab-availability matrix (the branches `renderMenu()`'s pro-without-vault
// default never exercises) ──────────────────────────────────────────────────

test("a Teams host sees all three tabs, People first, regardless of the connection's own vault", () => {
  renderMenu({ tier: "teams", connectionVaultId: "personal" });
  expect(screen.getByText("terminal.share.tabPeople")).toBeTruthy();
  expect(screen.getByText("terminal.share.tabInviteLink")).toBeTruthy();
  expect(screen.getByText("terminal.share.tabTeam")).toBeTruthy();
  // People is the default/active tab — its content is already on screen.
  expect(screen.getByPlaceholderText("terminal.share.peopleSearchPlaceholder")).toBeTruthy();
});

test("a Pro host whose connection is in a qualifying vault sees all three tabs too", () => {
  teamState.teams = [{ id: "vault-1", name: "Vault", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: [] }];
  renderMenu({ tier: "pro", connectionVaultId: "vault-1" });
  expect(screen.getByText("terminal.share.tabPeople")).toBeTruthy();
  expect(screen.getByText("terminal.share.tabInviteLink")).toBeTruthy();
  expect(screen.getByText("terminal.share.tabTeam")).toBeTruthy();
  expect(screen.getByPlaceholderText("terminal.share.peopleSearchPlaceholder")).toBeTruthy();
});
