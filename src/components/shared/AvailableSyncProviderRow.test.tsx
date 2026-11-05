import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { AvailableSyncProviderRow } from "./AvailableSyncProviderRow";
import { usePolicyStore } from "@/stores/policyStore";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

const plugin = { id: "plugin-s3-sync", name: "S3", author: "a", description: "d", repo: "r", version: "1.0.0", tags: [], theme: false, sourceId: "voltius" } as MarketplacePlugin;
const setPolicy = (policy: Record<string, unknown>) => usePolicyStore.setState({ machine: { policy, defaults: {} } });
const renderRow = () => render(<AvailableSyncProviderRow plugin={plugin} appVersion={null} busy={false} onInstall={() => {}} />);

afterEach(() => { cleanup(); setPolicy({}); });

test("install is disabled with a managed note when installs are not allowed", () => {
  setPolicy({ "plugins.allowInstall": false });
  renderRow();
  const button = screen.getByText("settings.plugins.browse.install").closest("button")!;
  expect(button.closest("fieldset[disabled]")).not.toBeNull();
  expect(screen.getByText("common.policy.managed")).toBeTruthy();
});

test("install stays enabled for an id the policy installs", () => {
  setPolicy({ "plugins.allowInstall": false, "plugins.install": ["plugin-s3-sync"] });
  renderRow();
  expect(screen.getByText("settings.plugins.browse.install").closest("fieldset[disabled]")).toBeNull();
});

test("install is enabled by default", () => {
  renderRow();
  expect(screen.getByText("settings.plugins.browse.install").closest("fieldset[disabled]")).toBeNull();
});
