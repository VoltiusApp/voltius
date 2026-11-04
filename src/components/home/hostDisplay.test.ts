// @vitest-environment jsdom
import { expect, test } from "vitest";
import type { Connection } from "@/types";
import { hostAddress, hostDisplayName } from "./hostDisplay";

const conn = (over: Partial<Connection>) => ({ id: "c", name: "", host: "h.example", username: "u", ...over }) as Connection;

test("name wins, then user@host", () => {
  expect(hostDisplayName(conn({ name: "  web  " }))).toBe("web");
  expect(hostDisplayName(conn({}))).toBe("u@h.example");
});

test("serial hosts show port and baud instead of a network address", () => {
  const serial = conn({ connection_type: "serial", serial_port: "/dev/ttyUSB0", serial_baud: 115200 });
  expect(hostDisplayName(serial)).toBe("/dev/ttyUSB0");
  expect(hostAddress(serial)).toContain("115200");
  expect(hostAddress(conn({ connection_type: "serial", serial_port: "/dev/ttyUSB0" }))).toBe("");
  expect(hostAddress(conn({}))).toBe("h.example");
});
