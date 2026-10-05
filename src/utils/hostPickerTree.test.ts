// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { Connection, Folder, VaultOption } from "@/types";
import { hostPickerRows, type HostPickerRow } from "./hostPickerTree";

function folder(id: string, opts: { parent?: string; vault?: string; type?: string; name?: string } = {}): Folder {
  return {
    id,
    name: opts.name ?? id,
    object_type: opts.type ?? "connection",
    parent_folder_id: opts.parent,
    vault_id: opts.vault ?? "personal",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    clocks: {},
  };
}

function host(id: string, opts: { folder?: string; vault?: string } = {}): Connection {
  return { id, host: `${id}.lan`, port: 22, username: "u", folder_id: opts.folder, vault_id: opts.vault ?? "personal" } as Connection;
}

const PERSONAL: VaultOption = { id: "personal", name: "Personal" };
const TEAM: VaultOption = { id: "team-1", name: "Ops" };

function outline(rows: HostPickerRow[]): string[] {
  return rows.map((r) => {
    if (r.kind === "vault") return `# ${r.name}`;
    if (r.kind === "folder") return `${"  ".repeat(r.depth)}${r.collapsed ? ">" : "v"} ${r.folder.name} (${r.count})`;
    return `${"  ".repeat(r.depth)}${r.connection.id}`;
  });
}

describe("hostPickerRows", () => {
  it("nests folders and lists folders before loose hosts", () => {
    const folders = [folder("servers"), folder("db", { parent: "servers" })];
    const hosts = [host("z"), host("a", { folder: "servers" }), host("pg", { folder: "db" })];
    expect(outline(hostPickerRows(hosts, folders, [PERSONAL], new Set()))).toEqual([
      "v servers (2)",
      "  v db (1)",
      "    pg",
      "  a",
      "z",
    ]);
  });

  it("groups by vault in vault-option order and only heads groups when several show", () => {
    const folders = [folder("net", { vault: "team-1" })];
    const hosts = [host("t", { vault: "team-1", folder: "net" }), host("p")];
    expect(outline(hostPickerRows(hosts, folders, [PERSONAL, TEAM], new Set()))).toEqual([
      "# Personal",
      "p",
      "# Ops",
      "v net (1)",
      "  t",
    ]);
    expect(outline(hostPickerRows([hosts[0]], folders, [PERSONAL, TEAM], new Set()))).toEqual([
      "v net (1)",
      "  t",
    ]);
  });

  it("files a host under its own vault's folders only", () => {
    const folders = [folder("shared", { vault: "team-1" })];
    expect(outline(hostPickerRows([host("p", { folder: "shared" })], folders, [PERSONAL, TEAM], new Set()))).toEqual(["p"]);
  });

  it("puts a host whose folder is gone at the vault root", () => {
    expect(outline(hostPickerRows([host("a", { folder: "deleted" })], [], [PERSONAL], new Set()))).toEqual(["a"]);
  });

  it("drops folders with no hosts beneath them and ignores other object types", () => {
    const folders = [folder("empty"), folder("keys", { type: "keychain" }), folder("full"), folder("hollow", { parent: "full" })];
    const hosts = [host("a", { folder: "full" }), host("k", { folder: "keys" })];
    expect(outline(hostPickerRows(hosts, folders, [PERSONAL], new Set()))).toEqual([
      "v full (1)",
      "  a",
      "k",
    ]);
  });

  it("hides a collapsed folder's contents but still counts them", () => {
    const folders = [folder("servers"), folder("db", { parent: "servers" })];
    const hosts = [host("a", { folder: "servers" }), host("pg", { folder: "db" })];
    expect(outline(hostPickerRows(hosts, folders, [PERSONAL], new Set(["servers"])))).toEqual(["> servers (2)"]);
  });

  it("sorts folders by name and keeps the caller's host order", () => {
    const folders = [folder("b", { name: "Beta" }), folder("a", { name: "alpha" })];
    const hosts = [host("h2", { folder: "a" }), host("h1", { folder: "a" }), host("x", { folder: "b" })];
    expect(outline(hostPickerRows(hosts, folders, [PERSONAL], new Set()))).toEqual([
      "v alpha (2)",
      "  h2",
      "  h1",
      "v Beta (1)",
      "  x",
    ]);
  });

  it("still shows hosts filed inside a parent cycle", () => {
    const folders = [folder("a", { parent: "b" }), folder("b", { parent: "a" })];
    const rows = hostPickerRows([host("h", { folder: "b" })], folders, [PERSONAL], new Set());
    expect(rows.filter((r) => r.kind === "host").map((r) => r.kind === "host" && r.connection.id)).toEqual(["h"]);
  });

  it("shows a vault once even when two options share its id", () => {
    expect(outline(hostPickerRows([host("p"), host("t", { vault: "team-1" })], [], [PERSONAL, TEAM, { id: "team-1", name: "Ops again" }], new Set()))).toEqual([
      "# Personal",
      "p",
      "# Ops",
      "t",
    ]);
  });

  it("names a vault missing from the options by its id rather than dropping its hosts", () => {
    expect(outline(hostPickerRows([host("p"), host("o", { vault: "gone" })], [], [PERSONAL], new Set()))).toEqual([
      "# Personal",
      "p",
      "# gone",
      "o",
    ]);
  });
});
