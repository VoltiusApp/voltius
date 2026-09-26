import { describe, it, expect } from "vitest";
import { connectionFromForm, connectionToFormData } from "./connectionStore";
import type { Connection, ConnectionFormData } from "@/types";

const form: ConnectionFormData = {
  host: "h", port: 22, username: "u", tags: [],
  proxy: { mode: "socks5", host: "p", port: 1080 },
  persist_session: false,
};

describe("connectionFromForm", () => {
  it("copies proxy and persist_session on create", () => {
    const c = connectionFromForm(form, { id: "c1", now: "2026-09-25T00:00:00Z" });
    expect(c.proxy).toEqual({ mode: "socks5", host: "p", port: 1080 });
    expect(c.persist_session).toBe(false);
    expect(c.clocks).toEqual({ created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z" });
  });

  it("keeps prev distro/icon/host when the form omits them on update", () => {
    const prev = connectionFromForm({ ...form, distro: "debian", icon: "x" }, { id: "c1", now: "t0" });
    const next = connectionFromForm({ tags: [], proxy: undefined }, { id: "c1", now: "t1", prev });
    expect(next.host).toBe("h");
    expect(next.distro).toBe("debian");
    expect(next.proxy).toBeUndefined();
    expect(next.created_at).toBe("t0");
    expect(next.updated_at).toBe("t1");
  });

  it("connectionToFormData keeps proxy", () => {
    const c = connectionFromForm(form, { id: "c1", now: "t0" }) as Connection;
    expect(connectionToFormData(c).proxy).toEqual(form.proxy);
  });

  it("clears fields the form omits instead of keeping prev's value (e.g. SSH → FTP switch)", () => {
    const prev = connectionFromForm(
      { ...form, identity_id: "id-1", jump_hosts: [{ id: "jh-1", connection_id: "c-9" }], notes: "keep me?" },
      { id: "c1", now: "t0" },
    );
    const ftpForm: ConnectionFormData = { host: "h", port: 21, username: "u", tags: [], connection_type: "ftp" };
    const next = connectionFromForm(ftpForm, { id: "c1", now: "t1", prev });
    expect(next.identity_id).toBeUndefined();
    expect(next.jump_hosts).toBeUndefined();
    expect(next.notes).toBeUndefined();
  });
});
