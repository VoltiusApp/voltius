import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ mobile: false }));
vi.mock("@iconify/react", () => ({ Icon: ({ icon, className }: { icon: string; className?: string }) => <i data-icon={icon} className={className} /> }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), isMobileShell: () => h.mobile }));

import { DisclosureToggle } from "./DisclosureToggle";

afterEach(() => { cleanup(); h.mobile = false; });

const toggle = (props: Partial<Parameters<typeof DisclosureToggle>[0]> = {}) => {
  render(<DisclosureToggle open={false} onToggle={() => {}} label="more" {...props} />);
  return screen.getByRole("button", { name: "more" });
};

test.each([
  [{}, "focus-ring flex items-center gap-1 w-full text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary) justify-center"],
  [{ align: "start" as const }, "focus-ring flex items-center gap-1 w-full text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary) text-left"],
  [{ look: "compact" as const }, "flex items-center gap-1 text-[11px] text-(--t-text-secondary)"],
  [{ look: "row" as const }, "w-full flex items-center gap-1.5 px-3 py-2 text-xs text-(--t-text-secondary)"],
])("desktop_classes_%#_are_unchanged", (props, className) => {
  expect(toggle(props).className).toBe(className);
});

test.each([[{}], [{ look: "compact" as const }], [{ look: "row" as const }]])("mobile_look_%#_is_a_touch_target", (props) => {
  h.mobile = true;
  expect(toggle(props).className).toContain("min-h-12");
});

test("chevron_follows_open_and_tap_toggles", () => {
  const onToggle = vi.fn();
  render(<DisclosureToggle open onToggle={onToggle} label="more" />);
  const button = screen.getByRole("button", { name: "more" });
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.querySelector("[data-icon='lucide:chevron-down']")).not.toBeNull();
  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledOnce();
});
