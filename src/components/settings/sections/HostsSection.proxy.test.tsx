import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { useConnectivitySettingsStore, DEFAULT_GLOBAL_PROXY } from "@/stores/connectivitySettingsStore";
import { GLOBAL_PROXY_PASSWORD_KEY } from "@/services/teamVaultSecretKeys";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(async (_key: string): Promise<string | null> => null),
  storeSecret: vi.fn(async (_key: string, _value: string) => {}),
  deleteSecret: vi.fn(async (_key: string) => {}),
  detectSystemProxy: vi.fn(async () => ({ kind: "socks5", host: "10.0.0.1", port: 1080 })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret, storeSecret: h.storeSecret, deleteSecret: h.deleteSecret }));
vi.mock("@/services/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/proxy")>()),
  detectSystemProxy: h.detectSystemProxy,
}));

import HostsSection from "./HostsSection";

const TYPED_PASSWORD = ["typed", "proxy", "value"].join("-");

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.clearAllMocks();
  useConnectivitySettingsStore.setState({ proxy: DEFAULT_GLOBAL_PROXY });
});
afterEach(cleanup);

test("the global proxy password is stored on blur, not on each keystroke, and never shown back", async () => {
  useConnectivitySettingsStore.setState({ proxy: { mode: "socks5", host: "p", port: 1080 } });
  render(<HostsSection />);
  const field = screen.getByLabelText("connections.form.proxy.password") as HTMLInputElement;
  fireEvent.change(field, { target: { value: TYPED_PASSWORD } });
  expect(h.storeSecret).not.toHaveBeenCalled();
  await act(async () => { fireEvent.blur(field); });
  expect(h.storeSecret).toHaveBeenCalledWith(GLOBAL_PROXY_PASSWORD_KEY, TYPED_PASSWORD);
  expect(field.value).toBe("");
  expect(field.placeholder).toBe("connections.form.proxy.passwordSaved");
});

function renderSocks5() {
  useConnectivitySettingsStore.setState({ proxy: { mode: "socks5", host: "p", port: 1080 } });
  render(<HostsSection />);
  return screen.getByLabelText("connections.form.proxy.password") as HTMLInputElement;
}

test("focusing and leaving the untouched password field writes nothing", async () => {
  h.getSecret.mockResolvedValueOnce("already-saved");
  const field = renderSocks5();
  await act(async () => {
    fireEvent.focus(field);
    fireEvent.blur(field);
  });
  expect(h.storeSecret).not.toHaveBeenCalled();
  expect(h.deleteSecret).not.toHaveBeenCalled();
  expect(field.placeholder).toBe("connections.form.proxy.passwordSaved");
});

test("typing then clearing the password deletes the saved one on blur", async () => {
  const field = renderSocks5();
  fireEvent.change(field, { target: { value: "x" } });
  fireEvent.change(field, { target: { value: "" } });
  await act(async () => { fireEvent.blur(field); });
  expect(h.deleteSecret).toHaveBeenCalledWith(GLOBAL_PROXY_PASSWORD_KEY);
  expect(h.storeSecret).not.toHaveBeenCalled();
});

test("a failed password write keeps the typed value and shows the error", async () => {
  h.storeSecret.mockRejectedValueOnce(new Error("vault locked"));
  const field = renderSocks5();
  fireEvent.change(field, { target: { value: TYPED_PASSWORD } });
  await act(async () => { fireEvent.blur(field); });
  expect(field.value).toBe(TYPED_PASSWORD);
  expect(screen.getByRole("alert").textContent).toContain("settings.hosts.proxy.passwordSaveFailed");
  expect(screen.getByRole("alert").textContent).toContain("vault locked");
});

test("system mode shows what the OS proxy detection found", async () => {
  useConnectivitySettingsStore.setState({ proxy: { mode: "system" } });
  render(<HostsSection />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/settings\.hosts\.proxy\.detected .*10\.0\.0\.1/)).toBeTruthy();
});

test("proxy host and username keystrokes stay local until the field loses focus", () => {
  renderSocks5();
  const host = screen.getByLabelText("connections.form.proxy.host") as HTMLInputElement;
  fireEvent.change(host, { target: { value: "n" } });
  fireEvent.change(host, { target: { value: "new" } });
  expect(host.value).toBe("new");
  expect(useConnectivitySettingsStore.getState().proxy.host).toBe("p");
  fireEvent.blur(host);
  expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "socks5", host: "new", port: 1080 });

  const user = screen.getByLabelText("connections.form.proxy.username") as HTMLInputElement;
  fireEvent.change(user, { target: { value: "bob" } });
  expect(useConnectivitySettingsStore.getState().proxy.username).toBeUndefined();
  fireEvent.blur(user);
  expect(useConnectivitySettingsStore.getState().proxy.username).toBe("bob");
});

test("the proxy port commits immediately and carries a host still being typed", () => {
  renderSocks5();
  const host = screen.getByLabelText("connections.form.proxy.host") as HTMLInputElement;
  fireEvent.change(host, { target: { value: "typed" } });
  fireEvent.change(screen.getByLabelText("connections.form.proxy.port"), { target: { value: "9050" } });
  expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "socks5", host: "typed", port: 9050 });
});

test("a host typed but never blurred is kept when the section closes", () => {
  renderSocks5();
  fireEvent.change(screen.getByLabelText("connections.form.proxy.host"), { target: { value: "late" } });
  cleanup();
  expect(useConnectivitySettingsStore.getState().proxy.host).toBe("late");
});

test("an outside change to the global proxy shows up in the fields", () => {
  renderSocks5();
  act(() => { useConnectivitySettingsStore.getState().setProxy({ mode: "socks5", host: "synced", port: 1080 }); });
  expect((screen.getByLabelText("connections.form.proxy.host") as HTMLInputElement).value).toBe("synced");
});
