// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";

const h = vi.hoisted(() => ({
  locked: false,
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  invoke: vi.fn(),
  saveTextFile: vi.fn(async () => true),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked, isOwner: true }) }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/saveFile", () => ({ saveTextFile: h.saveTextFile }));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  getTeamPolicy: h.get,
  putTeamPolicy: h.put,
  deleteTeamPolicy: h.del,
}));

import { DevicePolicyCard } from "./DevicePolicyCard";
import { SecurityPolicyPanel } from "./SecurityPolicyPanel";
import { PolicyRevisionMismatch, TeamPolicyRejected, type TeamPolicyDoc } from "@/services/teamService";
import { planRequiredError } from "@/services/planRequired";
import { useTeamStore } from "@/stores/teamStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { PolicyIssue } from "@/stores/policyStore";

const doc = (policy: Record<string, unknown>): TeamPolicyDoc => ({ version: 1, policy });
const STORED = doc({ "sync.types.key": false, "security.lockTimeoutMinutes": { $range: { max: 15 } } });

const setTeam = (policy: TeamPolicyDoc | null, revision = 1) =>
  useTeamStore.setState({
    teams: [{
      id: "t", name: "Acme", owner_id: "o", owner_tier: "business", created_at: "", role_ids: [],
      lock_policy: policy ? { max_minutes: 15, force_vault: false } : null, policy, policy_revision: revision,
    }],
    membersByTeam: {},
    loadTeams: vi.fn(async () => {}),
  });

const serve = (policy: TeamPolicyDoc | null, revision = 1) => {
  h.get.mockResolvedValue({ policy, revision, updated_at: null, updated_by: null });
  setTeam(policy, revision);
};

const checked = (policy: Record<string, unknown>, issues: Partial<PolicyIssue>[] = []) =>
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "policy_check_team_doc"
      ? { doc: { version: 1, policy, defaults: {} }, issues: issues.map((i) => ({ layer: "policy", key: null, message: "", ...i })) }
      : undefined);

async function importFile(json: unknown, text = JSON.stringify(json)) {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new File([text], "policy.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
  return screen.findByRole("dialog");
}

const saveButton = () => screen.getByRole("button", { name: "Save policy" }) as HTMLButtonElement;
const toastMessages = () => useNotificationStore.getState().toasts.map((t) => t.message);

async function importValid() {
  await screen.findByRole("button", { name: "Import" });
  checked({ "sync.types.key": false });
  await importFile({ version: 1, policy: { "sync.types.key": false } });
}

beforeEach(() => {
  h.locked = false;
  [h.get, h.put, h.del, h.invoke, h.saveTextFile].forEach((m) => m.mockReset());
  h.put.mockResolvedValue(undefined);
  h.invoke.mockResolvedValue(undefined);
  useNotificationStore.setState({ toasts: [] });
});
afterEach(cleanup);

test("empty state offers Import only", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  expect(await screen.findByRole("button", { name: "Import" })).toBeTruthy();
  expect(screen.getByText(/Uses the same format as policy.json/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
});

test("a stored policy shows its counts and key rows", async () => {
  serve(STORED);
  render(<DevicePolicyCard teamId="t" />);
  expect(await screen.findByText("1 locked · 1 limited")).toBeTruthy();
  expect(screen.getByText("sync.types.key")).toBeTruthy();
  expect(screen.getByText("max 15")).toBeTruthy();
});

test("import with a machine-only key shows the error and disables Save", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  checked({}, [{ kind: "notForTeam", key: "server.url", message: "server.url is machine-only; dropped" }]);
  await importFile({ version: 1, policy: { "server.url": "https://x" } });
  expect(screen.getByText("server.url")).toBeTruthy();
  expect(screen.getByText(/can only be set in machine policy/)).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
});

test("unknown key is a warning and Save stays enabled", async () => {
  serve(STORED, 4);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  checked({ "sync.types.key": false }, [{ kind: "unknownKey", key: "appSettings.foo.bar", message: "unknown key; ignored" }]);
  const imported = { version: 1, policy: { "sync.types.key": false, "appSettings.foo.bar": 1 } };
  await importFile(imported);
  expect(screen.getByText(/is unknown to this version/)).toBeTruthy();
  expect(saveButton().disabled).toBe(false);
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.put).toHaveBeenCalledWith("t", imported, 4));
});

test("a plain lock timeout warns about older versions and is saved as imported", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  const imported = { version: 1, policy: { "security.lockTimeoutMinutes": 15 } };
  checked(imported.policy);
  await importFile(imported);
  expect(screen.getByText(/Older ones need a maximum/)).toBeTruthy();
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.put).toHaveBeenCalledWith("t", imported, 0));
});

test("stale revision reloads and shows the conflict message", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await importValid();
  h.put.mockRejectedValue(new PolicyRevisionMismatch());
  h.get.mockClear();
  h.get.mockResolvedValue({ policy: STORED, revision: 2, updated_at: null, updated_by: null });
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.get).toHaveBeenCalled());
  expect(await screen.findByText("1 locked · 1 limited")).toBeTruthy();
  expect(toastMessages()).toContain("Someone else changed the team policy. Review it and import again.");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a revision change in the team list refetches the policy", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  expect(h.get).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({ policy: STORED, revision: 1, updated_at: null, updated_by: null });
  setTeam(STORED, 1);
  expect(await screen.findByText("1 locked · 1 limited")).toBeTruthy();
  expect(h.get).toHaveBeenCalledTimes(2);
});

test("updated-by resolves the member's name", async () => {
  h.get.mockResolvedValue({ policy: STORED, revision: 1, updated_at: new Date().toISOString(), updated_by: "u1" });
  setTeam(STORED, 1);
  useTeamStore.setState({
    membersByTeam: { t: [{ team_id: "t", user_id: "u1", member_name: "Jordan Lee", handle: "jordan", invited_by_display_name: null, joined_at: "", public_key: "", role_ids: [] }] },
  });
  render(<DevicePolicyCard teamId="t" />);
  expect(await screen.findByText("Updated by Jordan Lee, just now")).toBeTruthy();
});

test("lapsed team shows only Export and Clear", async () => {
  h.locked = true;
  serve(STORED);
  render(<DevicePolicyCard teamId="t" />);
  expect(await screen.findByRole("button", { name: "Export" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  expect(screen.getByText(/Importing a policy needs Business/)).toBeTruthy();
});

test("export saves policy.json with the stored document", async () => {
  serve(STORED);
  render(<DevicePolicyCard teamId="t" />);
  fireEvent.click(await screen.findByRole("button", { name: "Export" }));
  expect(h.saveTextFile).toHaveBeenCalledWith("policy.json", `${JSON.stringify(STORED, null, 2)}\n`);
});

test("clear confirms that the app-lock limits go too, then deletes", async () => {
  serve(STORED);
  h.del.mockResolvedValue(undefined);
  render(<DevicePolicyCard teamId="t" />);
  fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
  expect(screen.getByText(/also removes the app-lock limits/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear policy" }));
  await waitFor(() => expect(h.del).toHaveBeenCalledWith("t"));
});

test("only one older-versions footnote in the Security panel", async () => {
  serve(STORED);
  render(<SecurityPolicyPanel teamId="t" />);
  await screen.findByRole("button", { name: "Export" });
  expect(screen.getAllByText(/Older Voltius versions/)).toHaveLength(1);
});

test("below Business a stored device policy keeps the panel instead of the upsell", async () => {
  h.locked = true;
  serve(doc({ "sync.types.key": false }));
  useTeamStore.setState((s) => ({ teams: s.teams.map((t) => ({ ...t, lock_policy: null })) }));
  render(<SecurityPolicyPanel teamId="t" />);
  expect(await screen.findByRole("button", { name: "Export" })).toBeTruthy();
});

test("save keeps the revision loaded when the file was picked", async () => {
  serve(STORED, 1);
  render(<DevicePolicyCard teamId="t" />);
  await importValid();
  h.get.mockResolvedValue({ policy: STORED, revision: 2, updated_at: null, updated_by: null });
  setTeam(STORED, 2);
  await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.put).toHaveBeenCalledWith("t", expect.anything(), 1));
});

test("a defaults entry is an error that disables Save", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  checked({}, [{ kind: "notForTeam", layer: "defaults", key: "appSettings.locale", message: "cannot be a team default; dropped" }]);
  await importFile({ version: 1, policy: {}, defaults: { "appSettings.locale": "fr" } });
  expect(screen.getByText("Defaults belong in machine policy, not team policy")).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
});

test("a file over 64 KiB is refused before it is read", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await screen.findByRole("button", { name: "Import" });
  await importFile(null, `{"version":1,"policy":{},"pad":"${"x".repeat(64 * 1024)}"}`);
  expect(screen.getByText("This file isn't a valid policy.json")).toBeTruthy();
  expect(h.invoke).not.toHaveBeenCalledWith("policy_check_team_doc", expect.anything());
  expect(saveButton().disabled).toBe(true);
});

test("a server refusal names the key and keeps the preview open", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await importValid();
  h.put.mockRejectedValue(new TeamPolicyRejected("POLICY_MACHINE_ONLY_KEY", "server.url"));
  fireEvent.click(saveButton());
  await waitFor(() => expect(toastMessages()).toContain("The server refused this policy: server.url"));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("a lapsed plan during import shows the plan-required error", async () => {
  serve(null, 0);
  render(<DevicePolicyCard teamId="t" />);
  await importValid();
  h.put.mockRejectedValue(planRequiredError());
  fireEvent.click(saveButton());
  await waitFor(() => expect(toastMessages()).toContain("This needs the team's Business plan."));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("a server without team policy documents renders no card", async () => {
  h.get.mockResolvedValue(null);
  setTeam(null, 0);
  const { container } = render(<DevicePolicyCard teamId="t" />);
  await waitFor(() => expect(h.get).toHaveBeenCalled());
  await Promise.resolve();
  expect(container.innerHTML).toBe("");
});
