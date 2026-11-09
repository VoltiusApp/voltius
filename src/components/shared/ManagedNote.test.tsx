// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
}));
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
import { resetPolicy, withTeamPolicy } from "@/test/policy";
import { Managed, ManagedNote, RangeNote } from "./ManagedNote";

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
  resetPolicy();
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

  it("names the team when a team policy locks it", () => {
    withTeamPolicy({ "appSettings.toggles.cursor-blink": true });
    expect(render(body()).container.textContent).toBe('common.policy.managedByTeam {"team":"Acme"}go');
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
    lock("appSettings.plugins.overrides");
    const c = row("appSettings.plugins.overrides");
    expect(c.textContent).not.toContain("common.policy.managed");
    expect(syncButton(c)).not.toBeNull();
  });
});

describe("ManagedNote teams", () => {
  it("keeps the generic text without teams", () => {
    expect(render(<ManagedNote teams={[]} />).container.textContent).toBe("common.policy.managed");
  });

  it("names the first team when several shaped the entry", () => {
    expect(render(<ManagedNote teams={["Acme", "Beta"]} />).container.textContent).toBe('common.policy.managedByTeam {"team":"Acme"}');
  });
});

describe("RangeNote", () => {
  it.each([
    [{ max: 24 }, 'common.policy.rangeMax {"value":"24"}'],
    [{ min: 5 }, 'common.policy.rangeMin {"value":"5"}'],
    [{ min: 5, max: 30 }, 'common.policy.rangeBetween {"min":"5","max":"30"}'],
    [{ allowed: ["en", "fr"] }, 'common.policy.rangeAllowed {"values":"en, fr"}'],
    [{ allowed: [1, 12, 24, 72], max: 24 }, 'common.policy.rangeAllowed {"values":"1, 12, 24"}'],
  ])("picks the right sentence for %j", (range, text) => {
    expect(render(<RangeNote range={range} />).container.textContent).toBe(text);
  });

  it("formats each value and appends the unit", () => {
    const c = render(<RangeNote range={{ min: 1000, max: 30000 }} format={(v) => String((v as number) / 1000)} unit=" s" />).container;
    expect(c.textContent).toBe('common.policy.rangeBetween {"min":"1 s","max":"30 s"}');
  });
});

describe("SettingRow reset under a range", () => {
  const KEY = "appSettings.detachedTtlHours";
  const resetIn = (range: unknown) => {
    usePolicyStore.setState({ machine: { policy: { [KEY]: range }, defaults: {} } });
    const c = render(<SettingRow title="x" syncKey={KEY} dirty onReset={() => {}}><button type="button">c</button></SettingRow>).container;
    return c.querySelector('[title="settings.shared.resetToDefault"]');
  };

  it("hides reset when the built-in default is outside the range", () => {
    expect(resetIn({ $range: { min: 48 } })).toBeNull();
  });

  it("keeps reset when the built-in default is inside the range", () => {
    expect(resetIn({ $range: { max: 48 } })).not.toBeNull();
  });
});

describe("SettingRow note", () => {
  it.each([false, true])("renders the note (mobile=%s)", (mobile) => {
    platform.mobile = mobile;
    const c = render(<SettingRow title="x" note={<span data-testid="note">n</span>}><button type="button">c</button></SettingRow>).container;
    expect(c.querySelector('[data-testid="note"]')).not.toBeNull();
  });
});
