import { test, expect, beforeEach } from "vitest";
import { useConnectionPresenceStore } from "./connectionPresenceStore.ts";

const get = () => useConnectionPresenceStore.getState();

beforeEach(() => get().clear());

test("setSnapshot replaces state and de-duplicates user ids per connection", () => {
  get().setSnapshot([{ connection_id: "c1", user_ids: ["u1", "u1", "u2"] }]);
  expect(get().usageByConnection).toEqual({ c1: ["u1", "u2"] });
});

test("addUser is idempotent (no duplicate user)", () => {
  get().addUser("c1", "u1");
  get().addUser("c1", "u1");
  expect(get().usageByConnection.c1).toEqual(["u1"]);
});

test("addUser appends distinct users", () => {
  get().addUser("c1", "u1");
  get().addUser("c1", "u2");
  expect(get().usageByConnection.c1).toEqual(["u1", "u2"]);
});

test("removeUser drops the user and deletes the key when the last user leaves", () => {
  get().setSnapshot([{ connection_id: "c1", user_ids: ["u1", "u2"] }]);
  get().removeUser("c1", "u1");
  expect(get().usageByConnection.c1).toEqual(["u2"]);
  get().removeUser("c1", "u2");
  expect("c1" in get().usageByConnection).toBe(false); // key removed, not left as []
});

test("removeUser on an unknown connection is a no-op", () => {
  get().removeUser("nope", "u1");
  expect(get().usageByConnection).toEqual({});
});
