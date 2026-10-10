import { describe, expect, it } from "vitest";
import { audienceOf, describeRoute, type RouteInput } from "./tunnelRoute";

const placeholders = { anyAddress: "<your-ip>", sshTarget: "<host>" };
const route = (over: Partial<RouteInput>) => describeRoute({
  tunnelType: "local", localPort: "8080", remotePort: "80", bindHost: "127.0.0.1", remoteHost: "db", targetHost: "127.0.0.1", ...over,
}, placeholders);

describe("audienceOf", () => {
  it("reads the three choices back from a stored bind address", () => {
    expect(["127.0.0.1", "", "localhost", "[::1]"].map(audienceOf)).toEqual(["private", "private", "private", "private"]);
    expect(["0.0.0.0", "::"].map(audienceOf)).toEqual(["network", "network"]);
    expect(audienceOf("192.168.1.2")).toBe("custom");
  });
});

describe("describeRoute", () => {
  it("has nothing to say until the ports are filled in", () => {
    expect(route({ localPort: "" })).toBeNull();
    expect(route({ remotePort: "" })).toBeNull();
    expect(route({ tunnelType: "dynamic", remotePort: "" })).not.toBeNull();
  });

  it("describes a private local forward", () => {
    expect(route({})).toEqual({ variant: "local", listener: "localhost:8080", target: "db:80", command: "ssh -L 8080:db:80 <host>" });
  });

  it("names the listener once other devices can reach a local forward", () => {
    expect(route({ bindHost: "0.0.0.0" })).toMatchObject({ variant: "localShared", listener: "<your-ip>:8080", command: "ssh -L 0.0.0.0:8080:db:80 <host>" });
    expect(route({ bindHost: "192.168.1.2" })).toMatchObject({ variant: "localShared", listener: "192.168.1.2:8080", command: "ssh -L 192.168.1.2:8080:db:80 <host>" });
  });

  it("describes a remote forward from the server's side", () => {
    expect(route({ tunnelType: "remote", localPort: "3000", remotePort: "9000" })).toEqual({
      variant: "remote", listener: "127.0.0.1:9000", target: "127.0.0.1:3000", command: "ssh -R 9000:127.0.0.1:3000 <host>",
    });
    expect(route({ tunnelType: "remote", localPort: "3000", remotePort: "9000", bindHost: "0.0.0.0" })).toMatchObject({
      listener: "0.0.0.0:9000", command: "ssh -R 0.0.0.0:9000:127.0.0.1:3000 <host>",
    });
  });

  it("describes a SOCKS proxy", () => {
    expect(route({ tunnelType: "dynamic", localPort: "1080", remotePort: "" })).toEqual({ variant: "dynamic", listener: "localhost:1080", target: "", command: "ssh -D 1080 <host>" });
    expect(route({ tunnelType: "dynamic", localPort: "1080", bindHost: "0.0.0.0" })).toMatchObject({ variant: "dynamicShared", command: "ssh -D 0.0.0.0:1080 <host>" });
  });

  it("brackets IPv6 addresses the way ssh expects", () => {
    expect(route({ bindHost: "fe80::1", remoteHost: "::1" })).toMatchObject({ listener: "[fe80::1]:8080", target: "[::1]:80", command: "ssh -L [fe80::1]:8080:[::1]:80 <host>" });
  });
});
