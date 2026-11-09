import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  locked: false,
  emailDelivery: true,
  getToken: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  loadTeams: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked, isOwner: true }) }));
vi.mock("@/components/shared/BusinessLockBanner", () => ({
  BusinessLockLine: ({ label }: { label: string }) => <p>{label}</p>,
}));
vi.mock("@/services/serverCapabilities", () => ({ useServerEmailDelivery: () => h.emailDelivery }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: () => Promise.resolve("https://voltius.example.com") }));
vi.mock("@/services/enrollment/enrollmentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/enrollment/enrollmentApi")>()),
  enrollmentApi: { getToken: h.getToken, createToken: h.createToken, revokeToken: h.revokeToken },
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: ({ run }: { run: () => Promise<unknown> }) => run(),
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn().mockResolvedValue(undefined) }));

import { useTeamStore } from "@/stores/teamStore";
import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
import { parseEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { EnrolmentSection } from "./EnrolmentSection";

const ROLES = [
  { id: "r0", team_id: "t1", name: "owner", permissions: 0, is_builtin: true, position: 0, created_at: "" },
  { id: "r1", team_id: "t1", name: "member", permissions: 0, is_builtin: true, position: 2, created_at: "" },
  { id: "r2", team_id: "t1", name: "admin", permissions: 0, is_builtin: true, position: 1, created_at: "" },
];

const SECRET = "s".repeat(43);
const ID = "a".repeat(32);
const created = (over = {}) => ({
  id: ID, secret: SECRET, role: "member", allowed_domains: ["acme.com"], require_approval: false,
  expires_at: null, created_at: "2026-11-02T10:00:00Z", ...over,
});
const info = (over = {}) => {
  const { secret: _s, ...rest } = created();
  return { ...rest, created_by_name: "Jordan Lee", last_used_at: null, admitted_count: 12, pending_count: 2, ...over };
};

beforeEach(() => {
  h.locked = false;
  h.emailDelivery = true;
  h.getToken.mockResolvedValue(null);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Acme" } as never], loadTeams: h.loadTeams });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(<EnrolmentSection teamId="t1" roles={ROLES} />);
const addDomain = (text: string) => {
  const input = screen.getByPlaceholderText("members.enrollment.domainPlaceholder");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};
const createBtn = () => screen.getByText("members.enrollment.create") as HTMLButtonElement;

test("create disabled without a guard", async () => {
  mount();
  await screen.findByText("members.enrollment.create");
  expect(createBtn().disabled).toBe(true);
  addDomain("@Acme.COM");
  expect(createBtn().disabled).toBe(false);
});

test("owner is not offered and the domain is normalised before send", async () => {
  h.createToken.mockResolvedValue(created());
  mount();
  await screen.findByText("members.enrollment.create");
  expect(screen.queryByText("members.roleName.owner")).toBeNull();
  addDomain("@Acme.COM");
  fireEvent.click(createBtn());
  await waitFor(() => expect(h.createToken).toHaveBeenCalled());
  expect(h.createToken).toHaveBeenCalledWith("t1", { role: "member", allowed_domains: ["acme.com"], require_approval: false, expires_at: null });
});

test("created token shown once and gone after remount", async () => {
  h.createToken.mockResolvedValue(created());
  const first = mount();
  await screen.findByText("members.enrollment.create");
  addDomain("acme.com");
  fireEvent.click(createBtn());
  const field = (await screen.findByDisplayValue(/^vte1\./)) as HTMLInputElement;
  const parts = parseEnrollmentToken(field.value);
  expect(parts).toMatchObject({ id: ID, secret: SECRET, serverUrl: "https://voltius.example.com" });
  expect(screen.getByText("members.enrollment.copyNow")).toBeTruthy();

  first.unmount();
  h.getToken.mockResolvedValue(info());
  mount();
  await screen.findByText("members.enrollment.rotate");
  expect(screen.queryByDisplayValue(/^vte1\./)).toBeNull();
  expect(document.body.textContent).not.toContain(SECRET);
});

test("rotate asks for confirmation then shows the new token", async () => {
  h.getToken.mockResolvedValue(info());
  const rotated = created({ id: "b".repeat(32), secret: "r".repeat(43) });
  h.createToken.mockResolvedValue(rotated);
  mount();
  fireEvent.click(await screen.findByText("members.enrollment.rotate"));
  expect(h.createToken).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("members.enrollment.rotateConfirm"));
  const field = (await screen.findByDisplayValue(/^vte1\./)) as HTMLInputElement;
  expect(field.value.endsWith("r".repeat(43))).toBe(true);
  expect(h.createToken).toHaveBeenCalledWith("t1", { role: "member", allowed_domains: ["acme.com"], require_approval: false, expires_at: null });
});

test("revoke asks for confirmation", async () => {
  h.getToken.mockResolvedValueOnce(info()).mockResolvedValue(null);
  h.revokeToken.mockResolvedValue(undefined);
  mount();
  fireEvent.click(await screen.findByText("members.enrollment.revoke"));
  expect(h.revokeToken).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("members.enrollment.revokeConfirm"));
  await waitFor(() => expect(h.revokeToken).toHaveBeenCalledWith("t1"));
  await screen.findByText("members.enrollment.create");
});

test("server without email forces approval", async () => {
  h.emailDelivery = false;
  h.createToken.mockResolvedValue(created({ allowed_domains: [], require_approval: true }));
  mount();
  await screen.findByText("members.enrollment.create");
  const toggle = screen.getByRole("switch") as HTMLButtonElement;
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("members.enrollment.noEmail")).toBeTruthy();
  expect(createBtn().disabled).toBe(false);
  fireEvent.click(createBtn());
  await waitFor(() => expect(h.createToken.mock.calls[0][1].require_approval).toBe(true));
});

test("below Business shows the lock line and keeps Revoke", async () => {
  h.locked = true;
  h.getToken.mockResolvedValue(info());
  mount();
  await screen.findByText("members.enrollment.revoke");
  expect(screen.getByText("members.enrollment.lapsed")).toBeTruthy();
  expect(screen.queryByText("members.enrollment.rotate")).toBeNull();
  expect(screen.queryByText("members.enrollment.create")).toBeNull();
});

test("a lapsed-plan refusal refreshes the team", async () => {
  h.createToken.mockRejectedValue(new EnrollmentError("ENROLLMENT_UNAVAILABLE", 402));
  mount();
  await screen.findByText("members.enrollment.create");
  addDomain("acme.com");
  fireEvent.click(createBtn());
  await waitFor(() => expect(h.loadTeams).toHaveBeenCalled());
});
