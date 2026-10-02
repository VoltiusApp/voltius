import { describe, expect, it } from "vitest";
import type { Connection } from "@/types";
import { findDupes } from "./context";

describe("findDupes", () => {
  it("tells serial connections apart by port", () => {
    const existing = { id: "com3", connection_type: "serial", serial_port: "COM3", tags: [] } as unknown as Connection;
    const dupes = findDupes(
      { existingConnections: [existing], existingKeys: [], existingIdentities: [], existingSnippets: [], existingPfRules: [] },
      "personal",
    );
    expect(dupes.connection({ connection_type: "serial", serial_port: "COM3", tags: [] })).toBe("com3");
    expect(dupes.connection({ connection_type: "serial", serial_port: "COM4", tags: [] })).toBeUndefined();
  });
});
