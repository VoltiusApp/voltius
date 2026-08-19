import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => <i data-testid="icon" /> }));

const { PresenceAvatar } = await import("./PresenceAvatar");
const { avatarColor } = await import("./AvatarStack");

afterEach(cleanup);

test("uses the identity colour, so one person reads the same on every surface", () => {
  const { container } = render(<PresenceAvatar handle="merry-quartz-2597" />);
  const avatar = container.firstElementChild!.firstElementChild as HTMLElement;
  expect(avatar.style.background).toBe(hexToRgb(avatarColor("merry-quartz-2597")));
});

test("marks the control holder with the accent ring and the pencil badge", () => {
  const { container } = render(<PresenceAvatar handle="ada" hasControl />);
  expect((container.firstChild as HTMLElement).style.boxShadow).toContain("var(--t-accent)");
  expect(screen.getByTestId("icon")).toBeTruthy();
  expect((container.firstChild as HTMLElement).title).toBe("ada · shared.presence.hasControl");
});

// Both markers sit in the same corner; drawing them together would overlap.
test("suppresses the online dot while the control badge is shown", () => {
  const { container } = render(<PresenceAvatar handle="ada" hasControl online />);
  expect(container.querySelectorAll("span").length).toBe(1);
});

test("shows the online dot on its own", () => {
  const { container } = render(<PresenceAvatar handle="ada" online />);
  expect(container.querySelectorAll("span").length).toBeGreaterThan(0);
  expect(screen.queryByTestId("icon")).toBeNull();
});

test("falls back to the bare handle as the tooltip when nobody has control", () => {
  const { container } = render(<PresenceAvatar handle="ada" />);
  expect((container.firstChild as HTMLElement).title).toBe("ada");
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
