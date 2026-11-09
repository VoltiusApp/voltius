import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  locked: false,
  list: vi.fn(),
  warned: null as string | null,
  errorText: "",
  approve: vi.fn(),
  deny: vi.fn(),
  loadMembers: vi.fn(),
  loadTeams: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string, o?: { reason?: string }) => (o?.reason ? `${k}|${o.reason}` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked, isOwner: true }) }));
vi.mock("@/components/shared/BusinessLockBanner", () => ({
  BusinessLockLine: ({ label }: { label: string }) => <p>{label}</p>,
}));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children }: { children: React.ReactNode }) => <div data-row>{children}</div>,
}));
vi.mock("@/services/enrollment/enrollmentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/enrollment/enrollmentApi")>()),
  enrollmentApi: { listJoinRequests: h.list, approveJoinRequest: h.approve, denyJoinRequest: h.deny },
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown>; warning?: (r: unknown) => string | null; error?: (e: Error) => string }) => {
    try {
      const r = await o.run();
      h.warned = o.warning?.(r) ?? null;
      return r;
    } catch (e) {
      h.errorText = o.error?.(e as Error) ?? "";
      throw e;
    }
  },
}));

import { useTeamStore } from "@/stores/teamStore";
import { EnrollmentError, type JoinRequest } from "@/services/enrollment/enrollmentApi";
import { JoinRequestsSection } from "./JoinRequests";

const req = (over: Partial<JoinRequest> = {}): JoinRequest => ({
  id: "r1", user_id: "u1", email: "sam@acme.com", display_name: "Sam", reason: "approval",
  email_proven: true, created_at: "2026-11-02T10:00:00Z", ...over,
});

beforeEach(() => {
  h.locked = false;
  h.warned = null;
  h.errorText = "";
  h.list.mockReset().mockResolvedValue([req()]);
  h.approve.mockReset();
  h.deny.mockReset();
  h.loadMembers.mockReset().mockResolvedValue(undefined);
  h.loadTeams.mockReset().mockResolvedValue(undefined);
  useTeamStore.setState({ joinRequestsByTeam: {}, loadMembers: h.loadMembers, loadTeams: h.loadTeams } as never);
});
afterEach(() => cleanup());

test("email-unverified request offers only Deny", async () => {
  h.list.mockResolvedValue([req({ reason: "email_unverified", email_proven: false })]);
  render(<JoinRequestsSection teamId="t1" />);
  await screen.findByText("members.joinRequests.reason.email_unverified");
  expect(screen.queryByText("members.joinRequests.approve")).toBeNull();
  expect(screen.getByText("members.joinRequests.deny")).toBeTruthy();
});

test("a proven email still approvable after a lapse", async () => {
  h.list.mockResolvedValue([req({ reason: "email_unverified", email_proven: true })]);
  render(<JoinRequestsSection teamId="t1" />);
  const btn = await screen.findByText("members.joinRequests.approve");
  expect((btn as HTMLButtonElement).disabled).toBe(false);
});

test("seat-limit request has Approve disabled with the reason", async () => {
  h.list.mockResolvedValue([req({ reason: "seat_limit" })]);
  render(<JoinRequestsSection teamId="t1" />);
  const btn = (await screen.findByText("members.joinRequests.approve")) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.title).toBe("members.joinRequests.noSeatHint");
});

test("approve removes the row and reloads members", async () => {
  h.list.mockResolvedValueOnce([req()]).mockResolvedValue([]);
  h.approve.mockResolvedValue({ status: "admitted" });
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.approve"));
  await waitFor(() => expect(screen.queryByText("Sam")).toBeNull());
  expect(h.approve).toHaveBeenCalledWith("t1", "r1");
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
});

test("approve answered pending/seat_limit warns and keeps the row", async () => {
  h.list.mockResolvedValueOnce([req()]).mockResolvedValue([req({ reason: "seat_limit" })]);
  h.approve.mockResolvedValue({ status: "pending", reason: "seat_limit" });
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.approve"));
  await screen.findByText("members.joinRequests.reason.seat_limit");
  expect(h.warned).toBe("members.joinRequests.noSeatToast");
  expect(h.loadMembers).not.toHaveBeenCalled();
});

test("a lapsed plan refusal reloads teams", async () => {
  h.approve.mockRejectedValue(new EnrollmentError("ENROLLMENT_UNAVAILABLE", 402));
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.approve"));
  await waitFor(() => expect(h.loadTeams).toHaveBeenCalled());
});

test("a lapsed plan refusal shows the Business lock message", async () => {
  h.locked = true;
  render(<JoinRequestsSection teamId="t1" />);
  expect(await screen.findByText("members.enrollment.lapsed")).toBeTruthy();
});

test("a bare 402 explains the missing seat and reloads", async () => {
  h.approve.mockRejectedValue(new EnrollmentError(null, 402));
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.approve"));
  await waitFor(() => expect(h.errorText).toContain("members.joinRequests.noSeatToast"));
  expect(h.loadTeams).not.toHaveBeenCalled();
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
});

test("a 404 reloads the list", async () => {
  h.approve.mockRejectedValue(new EnrollmentError(null, 404));
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.approve"));
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
});

test("a failed reload keeps the previous list", async () => {
  render(<JoinRequestsSection teamId="t1" />);
  await screen.findByText("Sam");
  h.list.mockRejectedValue(new Error("offline"));
  await useTeamStore.getState().loadJoinRequests("t1");
  expect(useTeamStore.getState().joinRequestsByTeam.t1).toHaveLength(1);
});

test("deny removes the row", async () => {
  h.list.mockResolvedValueOnce([req()]).mockResolvedValue([]);
  h.deny.mockResolvedValue(undefined);
  render(<JoinRequestsSection teamId="t1" />);
  fireEvent.click(await screen.findByText("members.joinRequests.deny"));
  await waitFor(() => expect(screen.queryByText("Sam")).toBeNull());
  expect(h.deny).toHaveBeenCalledWith("t1", "r1");
});

test("an empty list renders nothing", async () => {
  h.list.mockResolvedValue([]);
  const { container } = render(<JoinRequestsSection teamId="t1" />);
  await waitFor(() => expect(h.list).toHaveBeenCalled());
  expect(container.querySelector("[data-join-requests]")).toBeNull();
});
