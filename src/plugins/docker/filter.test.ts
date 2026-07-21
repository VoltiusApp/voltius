import { describe, it, expect } from "vitest";
import { matchContainer, matchImage, matchVolume, matchNetwork, matchStack } from "./filter.ts";
import type { DockerContainer, DockerImage, DockerVolume, DockerNetwork, DockerStack } from "./types.ts";

const container: DockerContainer = {
  id: "abc123",
  names: ["web-nginx"],
  image: "nginx:latest",
  status: "Up 3 hours",
  state: "running",
} as DockerContainer;

const image: DockerImage = { id: "sha256:deadbeef", repo_tags: ["postgres:16"], size: 1, created: 0 };
const volume: DockerVolume = { name: "pgdata", driver: "local" };
const network: DockerNetwork = { id: "net99", name: "frontend", driver: "bridge" };
const stack: DockerStack = { name: "shop", status: "running(2)", config_files: [], running: 2, exited: 0, paused: 0, total: 2 };

describe("docker filter matchers", () => {
  it("empty and whitespace query matches everything", () => {
    expect(matchContainer(container, "")).toBe(true);
    expect(matchContainer(container, "   ")).toBe(true);
  });

  it("container matches name, image, status, state (case-insensitive)", () => {
    expect(matchContainer(container, "NGINX")).toBe(true); // name + image
    expect(matchContainer(container, "up 3")).toBe(true);   // status
    expect(matchContainer(container, "running")).toBe(true); // state
    expect(matchContainer(container, "zzz")).toBe(false);
  });

  it("image matches repo_tags and id", () => {
    expect(matchImage(image, "POSTGRES")).toBe(true);
    expect(matchImage(image, "deadbeef")).toBe(true);
    expect(matchImage(image, "mysql")).toBe(false);
  });

  it("volume matches name and driver", () => {
    expect(matchVolume(volume, "PGDATA")).toBe(true);
    expect(matchVolume(volume, "local")).toBe(true);
    expect(matchVolume(volume, "nfs")).toBe(false);
  });

  it("network matches name, driver, id", () => {
    expect(matchNetwork(network, "FRONT")).toBe(true);
    expect(matchNetwork(network, "bridge")).toBe(true);
    expect(matchNetwork(network, "net99")).toBe(true);
    expect(matchNetwork(network, "host")).toBe(false);
  });

  it("stack matches name and status", () => {
    expect(matchStack(stack, "SHOP")).toBe(true);
    expect(matchStack(stack, "running")).toBe(true);
    expect(matchStack(stack, "stopped")).toBe(false);
  });
});
