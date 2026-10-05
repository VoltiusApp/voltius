// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { connectionFromForm, connectionToFormData } from "./connectionStore";
import type { Connection, ConnectionFormData } from "@/types";

const form: ConnectionFormData = {
  host: "cloud.example.com", port: 443, username: "u", tags: [],
  connection_type: "webdav", webdav_url: "https://cloud.example.com/dav/",
};

describe("webdav connections", () => {
  it("round-trip webdav_url through the form shape", () => {
    const c = connectionFromForm(form, { id: "c1", now: "t0" }) as Connection;
    expect(c.webdav_url).toBe("https://cloud.example.com/dav/");
    expect(connectionToFormData(c).webdav_url).toBe("https://cloud.example.com/dav/");
  });

  it("keep prev's webdav_url when an update omits it", () => {
    const prev = connectionFromForm(form, { id: "c1", now: "t0" });
    const next = connectionFromForm({ tags: [], connection_type: "webdav" }, { id: "c1", now: "t1", prev });
    expect(next.webdav_url).toBe("https://cloud.example.com/dav/");
  });
});
