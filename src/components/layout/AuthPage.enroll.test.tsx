import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ isServerMode: vi.fn() }));

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

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = { serverUrl: "https://voltius.acme.com", id: ID, secret: "s".repeat(43) };

beforeEach(() => {
  h.isServerMode.mockReset();
  h.isServerMode.mockResolvedValue(false);
});
afterEach(cleanup);

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
