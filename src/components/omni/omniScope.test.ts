import { describe, expect, it } from "vitest";
import { detectScope } from "./omniScope";

describe("detectScope", () => {
  it.each([
    ["> disk", "snippets", "disk"],
    [">disk", "snippets", "disk"],
    ["@ term", "settings", "term"],
    ["@term", "settings", "term"],
    ["m> docker", "marketplace", "docker"],
    ["m>docker", "marketplace", "docker"],
    ["join K7M2", "join", "K7M2"],
    ["join>K7M2", "join", "K7M2"],
    ["join> ", "join", ""],
  ])("%s scopes to %s", (raw, category, rest) => {
    expect(detectScope(raw)).toEqual({ category, rest });
  });

  it.each(["prod-web", "joiner", "m-server", "me@host", ""])("leaves %s in the All scope", (raw) => {
    expect(detectScope(raw)).toBeNull();
  });
});
