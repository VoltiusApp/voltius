import { describe, test, expect } from "vitest";
import { classifyPorts, actionFor } from "./ports";
import type { PortMapping } from "./types";

function p(over: Partial<PortMapping>): PortMapping {
  return { host_ip: "0.0.0.0", host_port: 8080, container_port: 80, protocol: "tcp", ...over };
}

describe("classifyPorts", () => {
  test("a published web port is http and carries its scheme", () => {
    const [c] = classifyPorts([p({ host_port: 8080, container_port: 80 })]);
    expect(c.kind).toBe("http");
    expect(c.scheme).toBe("http");
    expect(c.full).toBe("8080→80/tcp");
    expect(c.short).toBe("8080");
    expect(c.inertReason).toBeNull();
  });

  test("443 and 8443 classify as https", () => {
    expect(classifyPorts([p({ host_port: 8443 })])[0].scheme).toBe("https");
    expect(classifyPorts([p({ host_port: 443 })])[0].scheme).toBe("https");
  });

  test("a published non-web tcp port is tcp", () => {
    expect(classifyPorts([p({ host_port: 5432, container_port: 5432 })])[0].kind).toBe("tcp");
  });

  test("udp and unpublished ports are inert with a reason", () => {
    const [udp] = classifyPorts([p({ protocol: "udp" })]);
    expect(udp.kind).toBe("inert");
    expect(udp.inertReason).toMatch(/UDP/i);

    const [unpub] = classifyPorts([p({ host_port: null, container_port: 80 })]);
    expect(unpub.kind).toBe("inert");
    expect(unpub.inertReason).toMatch(/not published/i);
    expect(unpub.short).toBe("80/tcp");
  });

  test("web ports sort first, then other tcp, then inert — each ascending", () => {
    const order = classifyPorts([
      p({ host_port: null, container_port: 9 }),
      p({ host_port: 5432, container_port: 5432 }),
      p({ host_port: 9000, container_port: 9000 }),
      p({ host_port: 3000, container_port: 3000 }),
      p({ host_port: 27017, container_port: 27017 }),
    ]).map((c) => c.short);
    expect(order).toEqual(["3000", "9000", "5432", "27017", "9/tcp"]);
  });
});

describe("actionFor", () => {
  test("maps kinds to host actions", () => {
    expect(actionFor("http")).toBe("browser");
    expect(actionFor("tcp")).toBe("copy");
    expect(actionFor("inert")).toBeNull();
  });
});
