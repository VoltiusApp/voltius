import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const calls = vi.hoisted(() => ({ quick: vi.fn(), join: vi.fn(async () => {}), omni: vi.fn(), home: vi.fn() }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/launch", () => ({ launchQuickConnect: calls.quick }));
vi.mock("@/services/teamSessionJoin", () => ({ joinSessionByCode: calls.join }));
vi.mock("@/services/resolveJoinInput", () => ({ isJoinInput: (s: string) => s.startsWith("voltius://join") }));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "v1" }));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ openOmniWith: calls.omni, setHomeView: calls.home }) },
}));

import { ConnectPrompt } from "./ConnectPrompt";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const type = (value: string) => fireEvent.change(screen.getByLabelText("home.firstRun.addressLabel"), { target: { value } });
const submit = () => fireEvent.submit(screen.getByLabelText("home.firstRun.addressLabel").closest("form")!);

test("user@host connects and leaves home", () => {
  render(<ConnectPrompt placeholder="p" searchFallback />);
  type("root@10.0.0.1");
  expect(screen.getByText("common.action.connect")).toBeTruthy();
  submit();
  expect(calls.quick).toHaveBeenCalledTimes(1);
  expect(calls.home).toHaveBeenCalledWith(false);
});

test("an invite code joins", () => {
  render(<ConnectPrompt placeholder="p" searchFallback />);
  type("voltius://join?x");
  expect(screen.getByText("home.firstRun.join")).toBeTruthy();
  submit();
  expect(calls.join).toHaveBeenCalledWith("voltius://join?x");
});

test("other text opens search with that text when searchFallback is on", () => {
  render(<ConnectPrompt placeholder="p" searchFallback />);
  type("api-prod");
  expect(screen.getByText("home.connect.search")).toBeTruthy();
  submit();
  expect(calls.omni).toHaveBeenCalledWith("api-prod");
  expect(calls.quick).not.toHaveBeenCalled();
});

test("without searchFallback other text shows the format hint and cannot submit", () => {
  render(<ConnectPrompt placeholder="p" />);
  type("api-prod");
  expect(screen.getByText("home.firstRun.addressHint")).toBeTruthy();
  expect((screen.getByText("common.action.connect") as HTMLButtonElement).disabled).toBe(true);
});

test.each([true, false])("an invalid port explains the range and connects nowhere (searchFallback=%s)", (searchFallback) => {
  render(<ConnectPrompt placeholder="p" searchFallback={searchFallback} />);
  type("ssh -p 70000 admin@host");
  expect(screen.getByRole("alert").textContent).toBe("omni.quickConnect.portRange");
  expect((screen.getByText("common.action.connect") as HTMLButtonElement).disabled).toBe(true);
  submit();
  expect(calls.quick).not.toHaveBeenCalled();
  expect(calls.omni).not.toHaveBeenCalled();
});
