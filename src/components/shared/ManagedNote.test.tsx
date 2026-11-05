// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn(async () => "linux") }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  useIsMobile: () => platform.mobile,
}));

import { usePolicyStore } from "@/stores/policyStore";
import { SettingRow } from "@/components/settings/sections/shared";
import { Managed } from "./ManagedNote";

const NONE = { policy: {}, defaults: {} };
const lock = (key: string) =>
  usePolicyStore.setState({ machine: { policy: { [key]: true }, defaults: {} } });

const body = () => (
  <Managed policyKey="appSettings.toggles.cursor-blink">
    <button type="button">go</button>
  </Managed>
);

beforeEach(() => {
  platform.mobile = false;
  usePolicyStore.setState({ machine: NONE, server: NONE });
});
afterEach(cleanup);

describe("Managed", () => {
  it("disables children when locked", () => {
    lock("appSettings.toggles.cursor-blink");
    const { container } = render(body());
    expect((container.querySelector("button") as HTMLButtonElement).matches(":disabled")).toBe(true);
    expect(container.textContent).toContain("common.policy.managed");
  });

  it("is transparent when unlocked", () => {
    const { container } = render(body());
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.textContent).not.toContain("common.policy.managed");
  });
});

describe("SettingRow policy lock", () => {
  const row = (key: string) =>
    render(
      <SettingRow title="x" syncKey={key}><button type="button">c</button></SettingRow>,
    ).container;
  const syncButton = (c: HTMLElement) => c.querySelector('[data-testid="sync-key-button"]');

  it("shows an enforced toggle as managed and hides its sync button", () => {
    lock("appSettings.toggles.cursor-blink");
    const c = row("appSettings.toggles.cursor-blink");
    expect(c.textContent).toContain("common.policy.managed");
    expect(syncButton(c)).toBeNull();
  });

  it.each([false, true])("puts the note beside the control only on desktop (mobile=%s)", (mobile) => {
    platform.mobile = mobile;
    lock("appSettings.toggles.cursor-blink");
    const c = render(
      <SettingRow title="x" desc="d" syncKey="appSettings.toggles.cursor-blink"><button type="button">c</button></SettingRow>,
    ).container;
    const note = [...c.querySelectorAll("span")].find((el) => el.textContent === "common.policy.managed")!;
    expect(note.parentElement!.contains(c.querySelector("button"))).toBe(!mobile);
    expect(c.querySelector("fieldset:disabled button")).not.toBeNull();
  });

  it("does not show an unenforced key as managed", () => {
    lock("appSettings.terminal.cursorStyle");
    const c = row("appSettings.terminal.cursorStyle");
    expect(c.textContent).not.toContain("common.policy.managed");
    expect(syncButton(c)).not.toBeNull();
  });
});
