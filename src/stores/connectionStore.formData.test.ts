// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Connection } from "@/types";
import { connectionToFormData } from "./connectionStore";

describe("connectionToFormData", () => {
  it("carries the port-knock settings", () => {
    const port_knock = { enabled: true, window_secs: 60 };
    expect(connectionToFormData({ id: "c", name: "n", port_knock } as Connection).port_knock).toEqual(port_knock);
  });
});
