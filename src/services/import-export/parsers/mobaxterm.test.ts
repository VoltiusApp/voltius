import { describe, expect, it } from "vitest";
import { connectionsFromMobaXterm } from "./mobaxterm";

describe("connectionsFromMobaXterm", () => {
  const ini = [
    "[Bookmarks_1]",
    "SubRep=Prod",
    "web=#109#0%web.example.com%2222%deploy%0",
    "no-user=#109#0%db.example.com%22%%3",
    "no-host=#109#0%%22%deploy%0",
    "rdp=#91#0%win.example.com%3389%admin",
  ].join("\n");

  it("keeps sessions without a saved username, which MobaXterm asks at login", () => {
    expect(connectionsFromMobaXterm(ini)).toEqual([
      { name: "web", host: "web.example.com", port: 2222, username: "deploy", auth_type: "password", tags: ["Prod"] },
      { name: "no-user", host: "db.example.com", port: 22, username: "", auth_type: "key", tags: ["Prod"] },
    ]);
  });
});
