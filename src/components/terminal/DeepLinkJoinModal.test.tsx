import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeepLinkJoinModal } from "./DeepLinkJoinModal";
import { useDeepLinkStore } from "@/stores/deepLinkStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const joinMock = vi.fn(async (..._args: unknown[]) => "local-1");
vi.mock("@/services/teamSessionJoin", () => ({
  joinTeamSessionAndOpenTab: (...args: unknown[]) => joinMock(...args),
}));

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const intent = { route: "join" as const, sessionId: SESSION, token: "tok" };

beforeEach(() => {
  joinMock.mockClear().mockResolvedValue("local-1");
  useDeepLinkStore.setState({ ready: true, queue: [], prompt: null });
});

afterEach(() => cleanup());

test("renders nothing without a prompt", () => {
  const { container } = render(<DeepLinkJoinModal />);
  expect(container.innerHTML).toBe("");
});

test("does not join until the user confirms", () => {
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkJoinModal />);
  expect(screen.getByText("terminal.share.deepLinkJoinTitle")).toBeTruthy();
  expect(joinMock).not.toHaveBeenCalled();
});

test("confirming joins with the link's session id and token", async () => {
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkJoinModal />);
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
  render(<DeepLinkJoinModal />);
  await userEvent.click(screen.getByText("common.action.cancel"));
  expect(joinMock).not.toHaveBeenCalled();
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

test("a failed join shows the error and keeps the sheet open", async () => {
  joinMock.mockRejectedValue(new Error("nope"));
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkJoinModal />);
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
  render(<DeepLinkJoinModal />);
  const button = screen.getByText("terminal.share.deepLinkJoinAction");
  await userEvent.click(button);
  await userEvent.click(button);
  expect(joinMock).toHaveBeenCalledTimes(1);
  resolveJoin("local-1");
});

test("a stale error is cleared when a new link is prompted", async () => {
  joinMock.mockRejectedValue(new Error("nope"));
  useDeepLinkStore.setState({ prompt: intent });
  render(<DeepLinkJoinModal />);
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
