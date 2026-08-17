import { describe, expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MiniAvatar, avatarColor, handleInitials } from "./AvatarStack";

afterEach(cleanup);

describe("handleInitials", () => {
  // Generated handles are adjective-noun-NNNN over 20 adjectives, so a single
  // leading letter collides constantly: every merry-* user would show "M".
  test("takes one letter from each of the first two words", () => {
    expect(handleInitials("merry-quartz-2597")).toBe("MQ");
    expect(handleInitials("swift-otter-4821")).toBe("SO");
  });

  test("degrades to one letter for a single-word custom handle", () => {
    expect(handleInitials("kevin")).toBe("K");
  });

  test("handles underscores, which custom handles allow", () => {
    expect(handleInitials("ada_lovelace")).toBe("AL");
  });

  test("returns a question mark for nothing usable", () => {
    expect(handleInitials("")).toBe("?");
  });

  // An older server (no migration 035) omits `handle` on TeamMember entirely.
  test("returns a question mark when the handle is missing", () => {
    expect(handleInitials(undefined)).toBe("?");
  });

  test("gives a different answer than a naive two-character slice", () => {
    // MultiplayerBar used to slice(0, 2), which yields "ME" for this handle —
    // the first two letters of one word rather than one from each word.
    expect(handleInitials("merry-quartz-2597")).not.toBe("ME");
  });
});

describe("avatarColor", () => {
  test("returns a stable color for a real handle", () => {
    const color = avatarColor("merry-quartz-2597");
    expect(color).toBe(avatarColor("merry-quartz-2597"));
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("does not throw for a missing or empty handle", () => {
    expect(() => avatarColor(undefined)).not.toThrow();
    expect(() => avatarColor("")).not.toThrow();
    expect(avatarColor(undefined)).toBe(avatarColor(""));
  });
});

describe("MiniAvatar initials size", () => {
  test("floors small avatars at a legible size", () => {
    const { container } = render(<MiniAvatar name="merry-quartz-2597" size={18} />);
    expect((container.firstChild as HTMLElement).style.fontSize).toBe("9px");
  });

  test("keeps the derived size once it clears the floor", () => {
    const { container } = render(<MiniAvatar name="merry-quartz-2597" size={40} />);
    expect((container.firstChild as HTMLElement).style.fontSize).toBe("12.8px");
  });
});
