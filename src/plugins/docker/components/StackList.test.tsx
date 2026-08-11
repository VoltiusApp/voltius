import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StackList } from "./StackList";
import type { DockerStack, DockerStackService, PortMapping } from "../types";

function port(host: number, container: number): PortMapping {
  return { host_ip: "0.0.0.0", host_port: host, container_port: container, protocol: "tcp" };
}

const stack: DockerStack = {
  name: "web",
  status: "",
  config_files: ["docker-compose.yml"],
  running: 1,
  exited: 0,
  paused: 0,
  total: 1,
};

const service: DockerStackService = {
  id: "svc1",
  name: "web_app_1",
  project: "web",
  service: "app",
  image: "nginx",
  state: "running",
  status: "Up",
  ports: [port(5432, 5432), port(6379, 6379)],
};

afterEach(cleanup);

describe("StackList service row ports", () => {
  test("an expanded stack's service row renders port chips for its published ports", () => {
    render(
      <StackList
        stacks={[stack]}
        services={[service]}
        selectedStackName="web"
        sessionId="s1"
        isRemote={false}
        localShell={null}
        onSelectStack={vi.fn()}
        onLogs={vi.fn()}
        onStackLogs={vi.fn()}
        onTerminal={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "5432" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6379" })).toBeTruthy();
  });

  test("a service with no ports renders no chips", () => {
    render(
      <StackList
        stacks={[stack]}
        services={[{ ...service, ports: [] }]}
        selectedStackName="web"
        sessionId="s1"
        isRemote={false}
        localShell={null}
        onSelectStack={vi.fn()}
        onLogs={vi.fn()}
        onStackLogs={vi.fn()}
        onTerminal={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "5432" })).toBeNull();
  });
});
