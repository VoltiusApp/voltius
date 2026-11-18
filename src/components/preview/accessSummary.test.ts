import { describe, expect, test } from "vitest";
import { PERM_BITS } from "@/services/permissions";
import type { TeamObjectType } from "@/services/teamObjects";
import { accessLevel, hasSecrets } from "./accessSummary";

const V = PERM_BITS.VIEW;
const C = PERM_BITS.CONNECT;

describe("accessLevel", () => {
  test.each<[TeamObjectType, number, string]>([
    ["connection", 0, "hidden"],
    ["connection", C, "hidden"],
    ["connection", V, "view"],
    ["connection", V | C, "connect"],
    ["connection", V | C | PERM_BITS.EDIT_CONNECTIONS, "edit"],
    ["key", V | C, "connect"],
    ["key", V | PERM_BITS.EDIT_KEYS, "edit"],
    ["identity", V | C, "connect"],
    ["port_forwarding_rule", V | C, "connect"],
    ["port_forwarding_rule", V | PERM_BITS.EDIT_CONNECTIONS, "edit"],
    ["folder", V | C, "connect"],
    ["folder", V | PERM_BITS.EDIT_FOLDERS, "edit"],
    ["snippet", V | C, "view"],
    ["snippet", V | PERM_BITS.EDIT_SNIPPETS, "edit"],
    ["snippet_folder", V | C, "view"],
    ["snippet_folder", V | PERM_BITS.EDIT_FOLDERS, "edit"],
    ["key", V | PERM_BITS.EDIT_SNIPPETS, "view"],
  ])("%s with mask %i is %s", (type, mask, level) => {
    expect(accessLevel(mask, type)).toBe(level);
  });
});

describe("hasSecrets", () => {
  test("is true only with VIEW_SECRETS", () => {
    expect(hasSecrets(V | PERM_BITS.VIEW_SECRETS)).toBe(true);
    expect(hasSecrets(V | C)).toBe(false);
  });
});
