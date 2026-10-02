import { describe, expect, it } from "vitest";
import { detectFormat } from "../formats";
import { bundleFromZoc } from "./zoc";

const host = (fields: Record<string, string | number>) => [
  "[HOST]",
  ...Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "number" ? v : `"${v}"`}`),
  "[/HOST]",
];

const zhd = [
  "ZOC9.00.0 // HOST DIRECTORY DEFAULT",
  "[STRUCTURE]",
  "NumSections=3",
  "Section#0=My Connections",
  "Section#1=Lab",
  "Section#2=TN3270",
  "Folder#7=0.0|Prod",
  "Folder#8=0.7.utf8|Bäckend",
  "Folder#9=1.0|Telnet only",
  "[/STRUCTURE]",
  "[DATA]",
  ...host({ section: 0, folder: 8, handle: 1, name: "api", connectto: "api.example.com:2222", deviceid: 9, username: "deploy", authfile: "C:\\keys\\id_ed25519", memo: "primary" }),
  ...host({ section: 0, folder: 0, handle: 2, name: "v6", connectto: "[2001:db8::1]:22", deviceid: 9 }),
  ...host({ section: 1, folder: 0, handle: 3, name: "bare", connectto: "bare.example.com" }),
  ...host({ section: 1, folder: 0, handle: 6, name: "profile default", connectto: "p.example.com", deviceid: -1 }),
  ...host({ section: 2, folder: 0, handle: 8, name: "mainframe", connectto: "z.example.com:23", deviceid: 3 }),
  ...host({ section: 1, folder: 9, handle: 4, name: "router", connectto: "192.168.1.1", deviceid: 3 }),
  ...host({ section: 1, folder: 0, handle: 5, name: "console", connectto: "", deviceid: 1, deviceopts: "[1]COM3:57600-7E2|75|350<Standard.zat>" }),
  ...host({ section: 1, folder: 0, handle: 7, name: "console default", connectto: "", deviceid: 1, deviceopts: "" }),
  "[/DATA]",
].join("\r\n");

describe("bundleFromZoc", () => {
  const bundle = bundleFromZoc(zhd);

  it("is detected from the host directory header", () => {
    expect(detectFormat(zhd)).toBe("zoc");
  });

  it("imports SSH, profile-default and serial entries and skips connection types Voltius lacks", () => {
    expect(bundle.connections).toEqual([
      { name: "api", host: "api.example.com", port: 2222, username: "deploy", auth_type: "key", tags: [], connection_type: "ssh", notes: "primary", _folder_eid: "zf8" },
      { name: "v6", host: "2001:db8::1", port: 22, username: "", auth_type: "password", tags: [], connection_type: "ssh", _folder_eid: "zs0" },
      { name: "bare", host: "bare.example.com", port: 22, username: "", auth_type: "password", tags: [], connection_type: "ssh", _folder_eid: "zs1" },
      { name: "profile default", host: "p.example.com", port: 22, username: "", auth_type: "password", tags: [], connection_type: "ssh", _folder_eid: "zs1" },
      {
        name: "console", tags: [], connection_type: "serial", serial_port: "COM3", serial_baud: 57600,
        serial_data_bits: 7, serial_parity: "even", serial_stop_bits: 2, serial_flow_control: "rts-cts", _folder_eid: "zs1",
      },
      { name: "console default", tags: [], connection_type: "serial", _folder_eid: "zs1" },
    ]);
  });

  it("nests folders under their section and drops folders left empty", () => {
    expect(bundle.folders).toEqual([
      { _eid: "zs0", name: "My Connections", object_type: "connection" },
      { _eid: "zs1", name: "Lab", object_type: "connection" },
      { _eid: "zf7", name: "Prod", object_type: "connection", parent_folder_eid: "zs0" },
      { _eid: "zf8", name: "Bäckend", object_type: "connection", parent_folder_eid: "zf7" },
    ]);
  });

  it("does not wrap a single section in a folder", () => {
    const single = bundleFromZoc(zhd.replace(/section=1/g, "section=0"));
    expect(single.folders.map((f) => f.name)).toEqual(["Prod", "Bäckend"]);
    expect(single.connections.find((c) => c.name === "bare")?._folder_eid).toBeUndefined();
  });
});
