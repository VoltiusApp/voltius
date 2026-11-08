import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePolicyStore } from "@/stores/policyStore";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import SFTPSection from "./SFTPSection";

const NONE = { policy: {}, defaults: {} };

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useSftpSettingsStore.setState({ autoRefreshIntervalMs: 2000 });
});
afterEach(cleanup);

const input = () => screen.getByRole("spinbutton") as HTMLInputElement;

test("SFTP input carries min and max and hides the minimum line", () => {
  usePolicyStore.setState({
    machine: { policy: { "appSettings.sftp.autoRefreshIntervalMs": { $range: { min: 5000, max: 30000 } } }, defaults: {} },
  });
  render(<SFTPSection />);
  expect(input().min).toBe("5");
  expect(input().max).toBe("30");
  expect(input().value).toBe("5");
  expect(screen.queryByText("settings.sftp.filePanel.refreshInterval.desc")).toBeNull();
  const unit = "settings.sftp.filePanel.refreshInterval.unit";
  expect(screen.getByText(`common.policy.rangeBetween {"min":"5 ${unit}","max":"30 ${unit}"}`)).toBeTruthy();
});

test("without a range the input keeps its floor and the minimum line", () => {
  render(<SFTPSection />);
  expect(input().min).toBe("0.5");
  expect(input().max).toBe("");
  expect(screen.getByText("settings.sftp.filePanel.refreshInterval.desc")).toBeTruthy();
});

test("a typed interval commits on blur, clamped to the range", () => {
  usePolicyStore.setState({
    machine: { policy: { "appSettings.sftp.autoRefreshIntervalMs": { $range: { min: 5000, max: 30000 } } }, defaults: {} },
  });
  render(<SFTPSection />);
  fireEvent.change(input(), { target: { value: "1" } });
  expect(input().value).toBe("1");
  fireEvent.change(input(), { target: { value: "10" } });
  expect(useSftpSettingsStore.getState().autoRefreshIntervalMs).toBe(2000);
  fireEvent.blur(input());
  expect(useSftpSettingsStore.getState().autoRefreshIntervalMs).toBe(10000);
  expect(input().value).toBe("10");

  fireEvent.change(input(), { target: { value: "90" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(useSftpSettingsStore.getState().autoRefreshIntervalMs).toBe(30000);
  expect(input().value).toBe("30");
});
