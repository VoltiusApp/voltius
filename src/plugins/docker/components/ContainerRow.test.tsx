import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainerRow } from "./ContainerRow";
import type { DockerContainer, PortMapping } from "../types";

function port(host: number, container: number): PortMapping {
  return { host_ip: "0.0.0.0", host_port: host, container_port: container, protocol: "tcp" };
}

function container(ports: PortMapping[]): DockerContainer {
  return {
    id: "c1",
    names: ["/web"],
    image: "nginx",
    status: "Up 2 minutes",
    state: "running",
    ports,
    created: 0,
  };
}

afterEach(cleanup);

describe("ContainerRow ports", () => {
  test("the collapsed row shows at most 2 chips plus an overflow control for 3+ ports", () => {
    const ports = [port(5432, 5432), port(6379, 6379), port(9200, 9200)];
    render(
      <ContainerRow
        container={container(ports)}
        sessionId="s1"
        isRemote={false}
        localShell={null}
        onLogs={vi.fn()}
        onTerminal={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "5432" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6379" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "9200" })).toBeNull();
    expect(screen.getByRole("button", { name: "+1" })).toBeTruthy();
  });

  test("the overflow control expands the row and the expanded details show every port", async () => {
    const ports = [port(5432, 5432), port(6379, 6379), port(9200, 9200)];
    render(
      <ContainerRow
        container={container(ports)}
        sessionId="s1"
        isRemote={false}
        localShell={null}
        onLogs={vi.fn()}
        onTerminal={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "+1" }));

    expect(screen.getByText("c1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /5432→5432\/tcp/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /6379→6379\/tcp/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /9200→9200\/tcp/ })).toBeTruthy();
  });
});
