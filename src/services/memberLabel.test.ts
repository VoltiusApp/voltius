import { test, expect } from "vitest";
import type { TeamMember } from "@/services/teamService";
import { inviterLabel, memberAvatarLabel, secondaryHandle } from "./memberLabel";

const roster = [
  { user_id: "u1", handle: "quiet-otter-1", member_name: "Jan" },
  { user_id: "u2", handle: "brisk-lynx-2", member_name: null },
] as TeamMember[];

test("inviterLabel prefers the roster member's name, then @handle", () => {
  expect(inviterLabel("quiet-otter-1", roster)).toBe("Jan");
  expect(inviterLabel("brisk-lynx-2", roster)).toBe("@brisk-lynx-2");
  expect(inviterLabel("gone-fox-9", roster)).toBe("@gone-fox-9");
  expect(inviterLabel("gone-fox-9", undefined)).toBe("@gone-fox-9");
  expect(inviterLabel(null, roster)).toBe("");
});

test("memberAvatarLabel and secondaryHandle", () => {
  expect(memberAvatarLabel({ member_name: "Jan", handle: "h" })).toBe("Jan");
  expect(memberAvatarLabel({ member_name: null, handle: "h" })).toBe("h");
  expect(memberAvatarLabel({ member_name: null, handle: undefined })).toBe("?");
  expect(secondaryHandle({ member_name: "Jan", handle: "h" })).toBe("@h");
  expect(secondaryHandle({ member_name: null, handle: "h" })).toBeNull();
});
