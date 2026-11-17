import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Mirrors i18next's real behaviour: an unknown key falls back to
    // defaultValue when the caller supplies one.
    t: (k: string, o?: { defaultValue?: string }) =>
      k.startsWith("members.roleBlurb.") && !k.endsWith("editor") && o?.defaultValue !== undefined
        ? o.defaultValue
        : k,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { roleChipColors, RoleToggleChip } from "./roleChips";

afterEach(cleanup);

test("a built-in role takes its palette colour, tinted for background and border", () => {
  expect(roleChipColors("editor")).toEqual({
    color: "#34d399",
    bg: "color-mix(in srgb, #34d399 14%, transparent)",
    border: "color-mix(in srgb, #34d399 60%, transparent)",
  });
});

test("an explicit role colour wins over the palette, background included", () => {
  expect(roleChipColors("editor", "#ff0000")).toMatchObject({ color: "#ff0000", bg: "color-mix(in srgb, #ff0000 14%, transparent)" });
});

test("an unknown role falls back to the caller's colour", () => {
  expect(roleChipColors("wrangler").color).toBe("var(--t-accent)");
  expect(roleChipColors("wrangler", null, "#123456").color).toBe("#123456");
});

test("a theme-variable colour still yields a valid tint", () => {
  expect(roleChipColors("member").border).toBe("color-mix(in srgb, var(--t-text-secondary) 60%, transparent)");
});

test("an active chip is tinted and bordered, an inactive one is not", () => {
  render(<RoleToggleChip name="editor" active onClick={() => {}} />);
  const active = screen.getByRole("button");
  expect(active.style.color).toBe("rgb(52, 211, 153)");
  expect(active.getAttribute("aria-pressed")).toBe("true");
  expect(active.style.border).toBe("1px solid color-mix(in srgb, rgb(52, 211, 153) 60%, transparent)");
  cleanup();

  render(<RoleToggleChip name="editor" active={false} onClick={() => {}} />);
  const inactive = screen.getByRole("button");
  expect(inactive.style.color).toBe("var(--t-text-dim)");
  expect(inactive.getAttribute("aria-pressed")).toBe("false");
  expect(inactive.style.background).toBe("transparent");
});

test("only the chip variants carry a tick, and only when active", () => {
  render(<RoleToggleChip name="editor" active onClick={() => {}} />);
  expect(document.querySelector('[data-icon="lucide:check"]')).toBeTruthy();
  cleanup();

  render(<RoleToggleChip name="editor" active={false} onClick={() => {}} />);
  expect(document.querySelector('[data-icon="lucide:check"]')).toBeNull();
  cleanup();

  render(<RoleToggleChip name="editor" active variant="pill" onClick={() => {}} />);
  expect(document.querySelector('[data-icon="lucide:check"]')).toBeNull();
});

test("each variant renders its own chrome", () => {
  render(<RoleToggleChip name="editor" active onClick={() => {}} variant="pill" />);
  expect(screen.getByRole("button").className).toContain("rounded-full");
  cleanup();

  render(<RoleToggleChip name="editor" active onClick={() => {}} variant="chip-sm" />);
  expect(screen.getByRole("button").className).toContain("px-2.5");
});

test("a toggle chip explains the role in plain language when asked", () => {
  render(<RoleToggleChip name="editor" active blurb onClick={() => {}} />);

  expect(screen.getByText("members.roleBlurb.editor")).toBeTruthy();
});

test("a custom role with no blurb renders no explanation line", () => {
  // Hand-written blurbs exist only for the built-in roles; a role the user
  // invented falls back to an empty string, which must render nothing.
  render(<RoleToggleChip name="deploy-bot" active blurb onClick={() => {}} />);

  expect(screen.queryByText(/members\.roleBlurb/)).toBeNull();
});

test("without the blurb prop the chip is unchanged", () => {
  render(<RoleToggleChip name="editor" active onClick={() => {}} />);

  expect(screen.queryByText(/members\.roleBlurb/)).toBeNull();
  expect(screen.getByRole("button").className).toContain("rounded-lg");
});

test("clicking reports, and a disabled chip does not", () => {
  const onClick = vi.fn();
  render(<RoleToggleChip name="editor" active onClick={onClick} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onClick).toHaveBeenCalledOnce();
  cleanup();

  const blocked = vi.fn();
  render(<RoleToggleChip name="editor" active onClick={blocked} disabled />);
  fireEvent.click(screen.getByRole("button"));
  expect(blocked).not.toHaveBeenCalled();
});
