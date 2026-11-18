import { expect, test } from "vitest";
import { ServerBlockedError } from "./accountErrors";

test("a blocked server error never serialises its pending secret", () => {
  const err = new ServerBlockedError("hunter2");
  expect(err.pendingSecret).toBe("hunter2");
  expect(JSON.stringify(err)).not.toContain("hunter2");
  expect(JSON.stringify({ ...err })).not.toContain("hunter2");
  expect(Object.keys(err)).not.toContain("pendingSecret");
});
