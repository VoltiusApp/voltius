import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ isServerMode: vi.fn(), invoke: vi.fn() }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: () => null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: vi.fn(),
  authenticateServerAccount: vi.fn(),
  login: vi.fn(),
  isServerMode: h.isServerMode,
}));
vi.mock("@/stores/notificationStore", () => ({ APP_SOURCE: { kind: "app" },
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/components/shared/VaultBackups", () => ({ VaultBackups: () => null }));
vi.mock("@/components/enrollment/EnrollForm", () => ({
  EnrollForm: (p: { source: string; token: { id: string }; onSkip(): void; onDone(o: unknown, r: unknown): void }) => (
    <div>
      <span>{`form:${p.source}:${p.token.id}`}</span>
      <button onClick={p.onSkip}>skip</button>
      <button onClick={() => p.onDone({ status: "member" }, { email: "jdoe@acme.com", teamName: "Acme" })}>done</button>
    </div>
  ),
}));
vi.mock("@/components/enrollment/EnrollOutcome", () => ({
  EnrollOutcome: (p: { teamName: string; onContinue(): void }) => <button onClick={p.onContinue}>{`outcome:${p.teamName}`}</button>,
}));

import AuthPage from "./AuthPage";
import { buildEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { usePolicyStore } from "@/stores/policyStore";

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = { serverUrl: "https://voltius.acme.com", id: ID, secret: "s".repeat(43) };

beforeEach(() => {
  h.isServerMode.mockReset();
  h.isServerMode.mockResolvedValue(false);
  h.invoke.mockReset();
  h.invoke.mockResolvedValue("unknown");
});
afterEach(() => {
  cleanup();
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
  useDeepLinkStore.getState().setUnpromptedHandler(null);
  useDeepLinkStore.setState({ ready: false, queue: [], prompt: null });
});

const enrollLink = () => ({ route: "enroll" as const, token: buildEnrollmentToken(TOKEN.serverUrl, ID, TOKEN.secret) });

test("a first-launch enrol target opens the enrol view, and Skip returns to the generic home", async () => {
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "machine" }} onReady={vi.fn()} />);
  expect(screen.getByText(`form:machine:${ID}`)).toBeTruthy();
  fireEvent.click(screen.getByText("skip"));
  expect(await screen.findByText("layout.auth.getStarted")).toBeTruthy();
  expect(screen.getByText("layout.enroll.tokenEntry.toggle")).toBeTruthy();
});

test("Skip after the form already signed in goes to the app", async () => {
  h.isServerMode.mockResolvedValue(true);
  const onReady = vi.fn();
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "link" }} onReady={onReady} />);
  fireEvent.click(screen.getByText("skip"));
  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
});

test("the outcome's Continue opens the app", async () => {
  const onReady = vi.fn();
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "machine" }} onReady={onReady} />);
  fireEvent.click(screen.getByText("done"));
  fireEvent.click(screen.getByText("outcome:Acme"));
  expect(onReady).toHaveBeenCalledTimes(1);
});

test("a pasted enrolment token opens the form as a paste token", async () => {
  render(<AuthPage isLocked={false} onReady={vi.fn()} />);
  fireEvent.click(screen.getByText("layout.enroll.tokenEntry.toggle"));
  const field = screen.getByPlaceholderText("layout.enroll.tokenEntry.placeholder");
  fireEvent.change(field, { target: { value: "nonsense" } });
  fireEvent.submit(field.closest("form")!);
  expect(screen.getByText("layout.enroll.tokenEntry.invalid")).toBeTruthy();
  fireEvent.change(field, { target: { value: ` ${buildEnrollmentToken(TOKEN.serverUrl, ID, TOKEN.secret)} ` } });
  fireEvent.submit(field.closest("form")!);
  expect(screen.getByText(`form:paste:${ID}`)).toBeTruthy();
});

test("Skip falls back to the generic home when the account mode can't be read", async () => {
  h.isServerMode.mockRejectedValue(new Error("keychain locked"));
  const onReady = vi.fn();
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "machine" }} onReady={onReady} />);
  fireEvent.click(screen.getByText("skip"));
  expect(await screen.findByText("layout.auth.getStarted")).toBeTruthy();
  expect(onReady).not.toHaveBeenCalled();
});

test("an enroll link queued after the first-launch screen appears opens the enrol view", async () => {
  render(<AuthPage isLocked={false} onReady={vi.fn()} />);
  expect(screen.getByText("layout.auth.getStarted")).toBeTruthy();
  act(() => useDeepLinkStore.getState().enqueue(enrollLink()));
  expect(screen.getByText(`form:link:${ID}`)).toBeTruthy();
  expect(useDeepLinkStore.getState().queue).toEqual([]);
  act(() => useDeepLinkStore.getState().setReady(true));
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

test("a late enroll link waits for the modal once the enrolment has signed in", async () => {
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "machine" }} onReady={vi.fn()} />);
  fireEvent.click(screen.getByText("done"));
  act(() => useDeepLinkStore.getState().enqueue(enrollLink()));
  expect(screen.getByText("outcome:Acme")).toBeTruthy();
  expect(useDeepLinkStore.getState().queue).toHaveLength(1);
});

test("an unlock screen leaves a late enroll link for the modal", async () => {
  render(<AuthPage isLocked onReady={vi.fn()} />);
  act(() => useDeepLinkStore.getState().enqueue(enrollLink()));
  expect(useDeepLinkStore.getState().queue).toHaveLength(1);
});

const reloadMachineToken = async (token: string) => {
  h.invoke.mockResolvedValue({ doc: { policy: { "enrollment.token": token }, defaults: {} }, issues: [] });
  await act(() => usePolicyStore.getState().load());
};

test("a machine token arriving after render opens enrol", async () => {
  render(<AuthPage isLocked={false} onReady={vi.fn()} />);
  expect(screen.getByText("layout.auth.getStarted")).toBeTruthy();
  await reloadMachineToken(buildEnrollmentToken(TOKEN.serverUrl, ID, TOKEN.secret));
  expect(screen.getByText(`form:machine:${ID}`)).toBeTruthy();
});

test("the same machine token does not reopen enrol", async () => {
  const raw = buildEnrollmentToken(TOKEN.serverUrl, ID, TOKEN.secret);
  usePolicyStore.setState({ machine: { policy: { "enrollment.token": raw }, defaults: {} } });
  render(<AuthPage isLocked={false} enrollTarget={{ token: TOKEN, source: "machine" }} onReady={vi.fn()} />);
  fireEvent.click(screen.getByText("skip"));
  expect(await screen.findByText("layout.auth.getStarted")).toBeTruthy();
  await reloadMachineToken(raw);
  expect(screen.getByText("layout.auth.getStarted")).toBeTruthy();
});
