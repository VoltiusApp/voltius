import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@voltius/ui", () => ({ StatusDot: () => null }));
vi.mock("../runtime", () => ({ getProxmoxApi: () => null, useProxmoxT: () => (k: string) => k }));

import { LxcList } from "./LxcList";
import type { LxcContainer } from "../types";

const ct = (vmid: number, status: string, mem_mb: number): LxcContainer => ({ vmid, name: `ct${vmid}`, status, mem_mb, disk_gb: 0, pid: 0 });
const noop = vi.fn(async () => {});

afterEach(cleanup);

describe("LxcList memory", () => {
  it("shows a container's memory when the host reports it, and nothing when it doesn't", () => {
    render(<LxcList containers={[ct(101, "running", 40), ct(105, "stopped", 0)]} onAction={noop} onSnapshots={noop} onShell={noop} />);
    expect(screen.getByText("40M")).toBeTruthy();
    expect(screen.queryByText("0M")).toBeNull();
  });
});
