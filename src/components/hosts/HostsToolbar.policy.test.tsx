import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePolicyStore } from "@/stores/policyStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ ToolbarViewControls: () => null }));
vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async () => [
    { name: "bash", path: "/bin/bash" },
    { name: "zsh", path: "/bin/zsh" },
    { name: "fish", path: "/usr/bin/fish" },
  ]),
}));

import { HomeToolbar } from "./HostsToolbar";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NONE = { policy: {}, defaults: {} };
const policy = (p: Record<string, unknown>) => usePolicyStore.setState({ machine: { policy: p, defaults: {} }, server: NONE });
const onOpenLocalTerminal = vi.fn();

const renderToolbar = () =>
  render(
    <HomeToolbar
      search=""
      onSearchChange={() => {}}
      onCreateHost={() => {}}
      onCreateFolder={() => {}}
      onOpenLocalTerminal={onOpenLocalTerminal}
      onOpenSerial={() => {}}
      onOpenImportExport={() => {}}
      layoutMode="grid"
      onLayoutModeChange={() => {}}
      sortMode="name-asc"
      onSortModeChange={() => {}}
    />,
  );

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useTerminalSettingsStore.setState({ preferredShell: null });
  onOpenLocalTerminal.mockClear();
});
afterEach(cleanup);

test("toolbar menu disabled with tooltip under a shell lock", async () => {
  policy({ "appSettings.terminal.preferredShell": "/bin/zsh" });
  renderToolbar();
  const chevron = (await screen.findByRole("button", { name: "common.policy.managed" })) as HTMLButtonElement;
  expect(chevron.getAttribute("title")).toBe("common.policy.managed");
  expect(chevron.getAttribute("aria-disabled")).toBe("true");
  expect(chevron.disabled).toBe(false);
  chevron.focus();
  expect(document.activeElement).toBe(chevron);
  fireEvent.click(chevron);
  fireEvent.keyDown(chevron, { key: "Enter" });
  expect(screen.queryByText("zsh")).toBeNull();
  fireEvent.click(screen.getByText("hosts.toolbar.terminal"));
  expect(onOpenLocalTerminal).toHaveBeenCalled();
});

test("the user's allowed path choice stays selected under a name-based list", async () => {
  policy({ "appSettings.terminal.preferredShell": { $range: { allowed: ["fish", "zsh"] } } });
  useTerminalSettingsStore.setState({ preferredShell: "/bin/zsh" });
  renderToolbar();
  const terminal = screen.getByText("hosts.toolbar.terminal").closest("button")!.parentElement!;
  fireEvent.click(await within(terminal).findByTitle("common.action.moreOptions"));
  const zsh = (await screen.findByText("zsh")).closest("button")!;
  const fish = screen.getByText("fish").closest("button")!;
  const checked = (b: Element) => !!b.querySelector('[data-icon="lucide:check"]');
  expect([checked(zsh), checked(fish)]).toEqual([true, false]);
});

test("with no allowed shell installed the menu offers the system default and keeps the note", async () => {
  policy({ "appSettings.terminal.preferredShell": { $range: { allowed: ["tcsh"] } } });
  renderToolbar();
  const terminal = screen.getByText("hosts.toolbar.terminal").closest("button")!.parentElement!;
  fireEvent.click(await within(terminal).findByTitle("common.action.moreOptions"));
  expect(await screen.findByText("hosts.toolbar.systemShell")).toBeTruthy();
  expect(screen.getByText('common.policy.rangeAllowed {"values":"tcsh"}')).toBeTruthy();
});

test("with a locked shell not installed the chevron keeps its managed tooltip", async () => {
  policy({ "appSettings.terminal.preferredShell": "tcsh" });
  renderToolbar();
  expect(await screen.findByRole("button", { name: "common.policy.managed" })).toBeTruthy();
});

test("toolbar menu lists the allowed shells and names them in a note", async () => {
  policy({ "appSettings.terminal.preferredShell": { $range: { allowed: ["zsh", "/usr/bin/fish"] } } });
  renderToolbar();
  const terminal = screen.getByText("hosts.toolbar.terminal").closest("button")!.parentElement!;
  const chevron = await within(terminal).findByTitle("common.action.moreOptions");
  fireEvent.click(chevron);
  expect(await screen.findByText("zsh")).toBeTruthy();
  expect(screen.queryByText("bash")).toBeNull();
  expect(screen.getByText('common.policy.rangeAllowed {"values":"zsh, fish"}')).toBeTruthy();
});
