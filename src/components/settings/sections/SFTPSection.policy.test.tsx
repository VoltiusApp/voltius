import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
