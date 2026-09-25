import { describe, expect, it } from "vitest";
import { connectionsFromCSV } from "./csv";

describe("connectionsFromCSV", () => {
  it("keeps rows without a username and skips rows without a host", () => {
    const csv = [
      "name,host,port,username",
      "web,web.example.com,2222,deploy",
      "db,db.example.com,,",
      "broken,,22,deploy",
    ].join("\n");
    expect(connectionsFromCSV(csv).map((c) => [c.name, c.host, c.port, c.username])).toEqual([
      ["web", "web.example.com", 2222, "deploy"],
      ["db", "db.example.com", 22, ""],
    ]);
  });
});
