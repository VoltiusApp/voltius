import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

import { ROLE_META, roleChipColors, RoleToggleChip } from "./roleChips";

afterEach(cleanup);

test("a built-in role takes its palette colour and background", () => {
  expect(roleChipColors("editor")).toMatchObject({ color: "#34d399", bg: ROLE_META.editor.bg });
});

test("an explicit role colour wins over the palette", () => {
  expect(roleChipColors("editor", "#ff0000").color).toBe("#ff0000");
});

test("an unknown role falls back, and its background is the colour at 10%", () => {
  expect(roleChipColors("wrangler")).toEqual({ meta: undefined, color: "var(--t-accent)", bg: "var(--t-accent)1a" });
  expect(roleChipColors("wrangler", null, "#123456")).toMatchObject({ color: "#123456", bg: "#1234561a" });
});

test("an explicit colour on a built-in role keeps the palette background", () => {
  expect(roleChipColors("editor", "#ff0000").bg).toBe(ROLE_META.editor.bg);
});

test("an active chip is tinted and bordered, an inactive one is not", () => {
  render(<RoleToggleChip name="editor" active onClick={() => {}} />);
  const active = screen.getByRole("button");
  expect(active.style.color).toBe("rgb(52, 211, 153)");
  expect(active.style.border).toBe("1px solid rgba(52, 211, 153, 0.267)");
  cleanup();

  render(<RoleToggleChip name="editor" active={false} onClick={() => {}} />);
  const inactive = screen.getByRole("button");
  expect(inactive.style.color).toBe("var(--t-text-dim)");
  expect(inactive.style.background).toBe("var(--t-bg-elevated)");
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
