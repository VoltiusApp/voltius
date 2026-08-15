import { describe, expect, test } from "vitest";
import { handleInitials } from "./AvatarStack";

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

  test("gives a different answer than a naive two-character slice", () => {
    // MultiplayerBar used to slice(0, 2), which yields "ME" for this handle —
    // the first two letters of one word rather than one from each word.
    expect(handleInitials("merry-quartz-2597")).not.toBe("ME");
  });
});
