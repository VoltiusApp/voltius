import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const android = vi.hoisted(() => ({ on: true }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<object>()), useIsAndroid: () => android.on, useIsMobile: () => android.on }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string | string[]) => (Array.isArray(k) ? k[0] : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { rowTapControl, mobileKey, MOBILE_HIDDEN_TOGGLES } from "./settingsMobileCore";
import { SettingRow, SettingsGroup } from "./sections/shared";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";

beforeEach(() => { android.on = true; });
afterEach(cleanup);

/** What MobileSettings does with a click on its body. */
const forward = (e: React.MouseEvent) => { if (!e.defaultPrevented) rowTapControl(e.target as Element)?.click(); };

test("rowTapControl forwards a tap on the row text to its control", () => {
  document.body.innerHTML = `<div data-setting-row><span id="t">Title</span><button id="c" data-row-control></button></div>`;
  expect(rowTapControl(document.getElementById("t"))?.id).toBe("c");
});

test("rowTapControl leaves taps on interactive children alone", () => {
  document.body.innerHTML = `<div data-setting-row><button id="r">Reset</button><button id="c" data-row-control></button></div>`;
  expect(rowTapControl(document.getElementById("r"))).toBeNull();
  expect(rowTapControl(document.getElementById("c"))).toBeNull();
});

test("rowTapControl skips disabled controls and rows without one", () => {
  document.body.innerHTML = `<div data-setting-row><span id="a">x</span><button data-row-control disabled></button></div><div data-setting-row><span id="b">y</span><input /></div><span id="out"></span>`;
  expect(rowTapControl(document.getElementById("a"))).toBeNull();
  expect(rowTapControl(document.getElementById("b"))).toBeNull();
  expect(rowTapControl(document.getElementById("out"))).toBeNull();
});

test("mobileKey tries the touch wording first on Android only", () => {
  expect(mobileKey("a.b", true)).toEqual(["a.bMobile", "a.b"]);
  expect(mobileKey("a.b", false)).toBe("a.b");
  expect(MOBILE_HIDDEN_TOGGLES.has("group-tabs-by-host")).toBe(true);
});

test("Android: tapping a switch row's title toggles it", () => {
  const onChange = vi.fn();
  render(
    <div onClick={forward}>
      <SettingsGroup title="Group">
        <SettingRow title="Cursor blink" desc="Blink it"><Toggle checked={false} onChange={onChange} /></SettingRow>
      </SettingsGroup>
    </div>,
  );
  fireEvent.click(screen.getByText("Cursor blink"));
  expect(onChange).toHaveBeenCalledWith(true);
});

test("Android: Reset is a visible text button only while dirty", () => {
  const onReset = vi.fn();
  const { rerender } = render(<SettingRow title="X" dirty onReset={onReset}><Toggle checked onChange={() => {}} /></SettingRow>);
  const reset = screen.getByText("settings.shared.reset");
  expect(reset.className).not.toContain("opacity-0");
  fireEvent.click(reset);
  expect(onReset).toHaveBeenCalled();
  rerender(<SettingRow title="X" dirty={false} onReset={onReset}><Toggle checked onChange={() => {}} /></SettingRow>);
  expect(screen.queryByText("settings.shared.reset")).toBeNull();
});

test("Android: a picker in a row shows its value as trailing text and is the row control", () => {
  render(
    <SettingRow title="Cursor style">
      <FormSelect value="bar" options={[{ value: "bar", label: "Bar" }, { value: "block", label: "Block" }]} onChange={() => {}} />
    </SettingRow>,
  );
  const trigger = screen.getByText("Bar").closest("button")!;
  expect(trigger.hasAttribute("data-row-control")).toBe(true);
  expect(trigger.className).not.toContain("form-input");
});

test("desktop rows are unchanged: hover reset, boxed picker, no row control on the picker", () => {
  android.on = false;
  render(
    <SettingRow title="Cursor style" dirty onReset={() => {}}>
      <FormSelect value="bar" options={[{ value: "bar", label: "Bar" }]} onChange={() => {}} />
    </SettingRow>,
  );
  expect(screen.queryByText("settings.shared.reset")).toBeNull();
  const trigger = screen.getByText("Bar").closest("button")!;
  expect(trigger.className).toContain("form-input");
  expect(trigger.hasAttribute("data-row-control")).toBe(false);
});
