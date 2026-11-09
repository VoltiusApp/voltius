import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { useRef, useState } from "react";

const h = vi.hoisted(() => ({
  locked: false,
  emailDelivery: true,
  getToken: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  loadTeams: vi.fn(),
  serverUrl: "https://voltius.example.com" as string | null,
  toasts: [] as string[],
  failed: null as unknown,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "joined" in o ? `${k}|${o.joined}|${o.waiting}` : k),
  }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked, isOwner: true }) }));
vi.mock("@/components/shared/BusinessLockBanner", () => ({
  BusinessLockLine: ({ label }: { label: string }) => (h.locked ? <p>{label}</p> : null),
}));
vi.mock("@/services/serverCapabilities", () => ({ useServerEmailDelivery: () => h.emailDelivery }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: () => Promise.resolve(h.serverUrl) }));
vi.mock("@/services/enrollment/enrollmentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/enrollment/enrollmentApi")>()),
  enrollmentApi: { getToken: h.getToken, createToken: h.createToken, revokeToken: h.revokeToken },
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async ({ run, pending, success }: { run: () => Promise<unknown>; pending: string; success: string }) => {
    h.toasts.push(pending);
    try {
      const r = await run();
      h.toasts.push(success);
      return r;
    } catch (e) {
      h.failed = e;
      throw e;
    }
  },
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn().mockResolvedValue(undefined) }));

import { useTeamStore } from "@/stores/teamStore";
import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
import { parseEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { EnrolmentSection } from "./EnrolmentSection";

const ROLES = [
  { id: "r0", team_id: "t1", name: "owner", permissions: 0, is_builtin: true, position: 0, created_at: "" },
  { id: "r1", team_id: "t1", name: "member", permissions: 0, is_builtin: true, position: 2, created_at: "" },
  { id: "r2", team_id: "t1", name: "admin", permissions: 0, is_builtin: true, position: 1, created_at: "" },
];

const DAY = 24 * 3600_000;
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
  h.serverUrl = "https://voltius.example.com";
  h.toasts = [];
  h.failed = null;
  h.getToken.mockResolvedValue(null);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Acme" } as never], loadTeams: h.loadTeams, joinRequestsByTeam: {} });
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
  expect(h.toasts).toEqual(["members.enrollment.toast.rotate.pending", "members.enrollment.toast.rotate.done"]);
  expect(field.getAttribute("aria-label")).toBe("members.enrollment.tokenLabel");
});

test("rotate and revoke are disabled while a rotation runs", async () => {
  h.getToken.mockResolvedValue(info());
  h.createToken.mockReturnValue(new Promise(() => {}));
  mount();
  fireEvent.click(await screen.findByText("members.enrollment.rotate"));
  fireEvent.click(screen.getByText("members.enrollment.rotateConfirm"));
  await waitFor(() => expect(h.createToken).toHaveBeenCalled());
  expect((screen.getByText("members.enrollment.rotate").closest("button") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText("members.enrollment.revoke") as HTMLButtonElement).disabled).toBe(true);
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

const rotateWith = async (over: object) => {
  h.getToken.mockResolvedValue(info(over));
  h.createToken.mockResolvedValue(created());
  mount();
  fireEvent.click(await screen.findByText("members.enrollment.rotate"));
  fireEvent.click(screen.getByText("members.enrollment.rotateConfirm"));
  await waitFor(() => expect(h.createToken).toHaveBeenCalled());
  return h.createToken.mock.calls[0][1].expires_at as string | null;
};

test("rotate keeps a future expiry", async () => {
  const future = new Date(Date.now() + 5 * DAY).toISOString();
  expect(await rotateWith({ expires_at: future })).toBe(future);
});

test("rotating an expired token keeps its lifetime from now", async () => {
  const now = Date.now();
  const expiresAt = await rotateWith({
    created_at: new Date(now - 40 * DAY).toISOString(),
    expires_at: new Date(now - 10 * DAY).toISOString(),
  });
  expect(Math.abs(new Date(expiresAt!).getTime() - (now + 30 * DAY))).toBeLessThan(60_000);
});

test("rotating a never-expiring token keeps it never-expiring", async () => {
  expect(await rotateWith({ expires_at: null })).toBeNull();
});

test("no server url shows no token", async () => {
  h.serverUrl = null;
  h.createToken.mockResolvedValue(created());
  mount();
  await screen.findByText("members.enrollment.create");
  addDomain("acme.com");
  fireEvent.click(createBtn());
  await waitFor(() => expect(h.failed).toBeInstanceOf(Error));
  expect(h.createToken).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue(/^vte1\./)).toBeNull();
});

test("a failed load offers a retry and never the create form", async () => {
  h.getToken.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
  mount();
  const retry = await screen.findByText("common.action.retry");
  expect(screen.getByText("members.enrollment.loadFailed")).toBeTruthy();
  expect(screen.queryByText("members.enrollment.create")).toBeNull();
  fireEvent.click(retry);
  await screen.findByText("members.enrollment.create");
  expect(screen.queryByText("members.enrollment.loadFailed")).toBeNull();
});

test.each([
  ["a server without enrolment", new EnrollmentError(null, 404)],
  ["team invites switched off", new EnrollmentError("TEAM_INVITES_DISABLED", 403)],
])("%s renders nothing", async (_name, err) => {
  h.getToken.mockRejectedValue(err);
  const { container } = mount();
  await waitFor(() => expect(h.getToken).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector("[data-enrolment]")).toBeNull());
  expect(screen.queryByText("members.enrollment.create")).toBeNull();
});

test("a load for a previous team is ignored", async () => {
  let resolveFirst: (v: unknown) => void = () => {};
  h.getToken.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; })).mockResolvedValue(null);
  const view = mount();
  view.rerender(<EnrolmentSection teamId="t2" roles={ROLES} />);
  await screen.findByText("members.enrollment.create");
  resolveFirst(info());
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText("members.enrollment.rotate")).toBeNull();
  expect(screen.getByText("members.enrollment.create")).toBeTruthy();
});

test("an expired token says so and points at rotate", async () => {
  h.getToken.mockResolvedValue(info({ expires_at: new Date(Date.now() - DAY).toISOString() }));
  mount();
  await screen.findByText("members.enrollment.rotate");
  expect(document.body.textContent).toContain("members.enrollment.expiredOn");
  expect(document.body.textContent).not.toContain("members.enrollment.expiresOn");
  expect(document.body.textContent).toContain("members.enrollment.expiredHint");
});

test("domains keep the part after the last @ and reject non-hostnames", async () => {
  h.createToken.mockResolvedValue(created());
  mount();
  await screen.findByText("members.enrollment.create");
  addDomain("not a domain");
  expect(screen.getByText("members.enrollment.invalidDomain")).toBeTruthy();
  expect(createBtn().disabled).toBe(true);
  addDomain("sam@b@Acme.COM");
  expect(screen.queryByText("members.enrollment.invalidDomain")).toBeNull();
  for (const bad of ["acme", "-a.com", "a-.com", "a..com", `${"a".repeat(64)}.com`]) {
    addDomain(bad);
    expect(screen.getByText("members.enrollment.invalidDomain")).toBeTruthy();
  }
  fireEvent.click(createBtn());
  await waitFor(() => expect(h.createToken.mock.calls[0][1].allowed_domains).toEqual(["acme.com"]));
});

const press = (el: Element) => {
  fireEvent.pointerDown(el);
  fireEvent.mouseDown(el);
  fireEvent.pointerUp(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
};

function SharePopover() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <button ref={anchorRef}>share</button>
      <span>{open ? "popover-open" : "popover-closed"}</span>
      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={320}>
        <EnrolmentSection teamId="t1" roles={ROLES} />
      </PickerSurface>
    </>
  );
}

test("confirming a rotation inside the share popover keeps it open and shows the new token", async () => {
  h.getToken.mockResolvedValue(info());
  h.createToken.mockResolvedValue(created({ id: "b".repeat(32), secret: "r".repeat(43) }));
  render(<SharePopover />);
  press(await screen.findByText("members.enrollment.rotate"));
  press(screen.getByText("members.enrollment.rotateConfirm"));
  const field = (await screen.findByDisplayValue(/^vte1\./)) as HTMLInputElement;
  expect(field.value.endsWith("r".repeat(43))).toBe(true);
  expect(screen.getByText("popover-open")).toBeTruthy();
});

test("cancelling a confirm inside the share popover keeps it open", async () => {
  h.getToken.mockResolvedValue(info());
  render(<SharePopover />);
  press(await screen.findByText("members.enrollment.revoke"));
  press(screen.getByText("common.action.cancel"));
  expect(screen.queryByText("members.enrollment.revokeConfirm")).toBeNull();
  expect(screen.getByText("popover-open")).toBeTruthy();
  expect(screen.getByText("members.enrollment.revoke")).toBeTruthy();
});

test("a join-requests change refreshes the counts and keeps the fresh token", async () => {
  h.getToken.mockResolvedValue(info());
  h.createToken.mockResolvedValue(created());
  mount();
  fireEvent.click(await screen.findByText("members.enrollment.rotate"));
  fireEvent.click(screen.getByText("members.enrollment.rotateConfirm"));
  await screen.findByDisplayValue(/^vte1\./);
  await waitFor(() => expect(screen.getByText("members.enrollment.counts|12|2")).toBeTruthy());
  h.getToken.mockResolvedValue(info({ admitted_count: 13, pending_count: 1 }));
  act(() => useTeamStore.setState({ joinRequestsByTeam: { t1: [] } }));
  await screen.findByText("members.enrollment.counts|13|1");
  expect(screen.getByDisplayValue(/^vte1\./)).toBeTruthy();
});
