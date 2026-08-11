import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortChips } from "./PortChips";
import { initDockerRuntime } from "../runtime";
import type { PluginAPI } from "@/plugins/api";
import type { PortMapping } from "../types";

const reach = vi.fn(async () => ({ address: "http://localhost:8080", localPort: 8080, tunneled: true }));
const toast = vi.fn();

function p(over: Partial<PortMapping>): PortMapping {
  return { host_ip: "0.0.0.0", host_port: 8080, container_port: 80, protocol: "tcp", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  initDockerRuntime({ ports: { reach }, notifications: { toast } } as unknown as PluginAPI);
});
afterEach(cleanup);

describe("PortChips", () => {
  test("renders nothing without ports", () => {
    const { container } = render(<PortChips ports={[]} sessionId="s1" isRemote />);
    expect(container.firstChild).toBeNull();
  });

  test("a web chip asks the host for a browser action", async () => {
    render(<PortChips ports={[p({ host_port: 8080 })]} sessionId="s1" isRemote />);
    await userEvent.click(screen.getByRole("button", { name: /8080/ }));
    await waitFor(() =>
      expect(reach).toHaveBeenCalledWith({
        sessionId: "s1", isRemote: true, hostPort: 8080, hostIp: "0.0.0.0", scheme: "http", action: "browser",
      }),
    );
  });

  test("a non-web chip asks for a copy action", async () => {
    render(<PortChips ports={[p({ host_port: 5432, container_port: 5432 })]} sessionId="s1" isRemote={false} />);
    await userEvent.click(screen.getByRole("button", { name: /5432/ }));
    await waitFor(() => expect(reach).toHaveBeenCalledWith(expect.objectContaining({ action: "copy", isRemote: false })));
  });

  test("an inert port renders a disabled chip and never calls the host", async () => {
    render(<PortChips ports={[p({ host_port: null, container_port: 80 })]} sessionId="s1" isRemote />);
    const chip = screen.getByRole("button", { name: /80\/tcp/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    await userEvent.click(chip);
    expect(reach).not.toHaveBeenCalled();
  });

  test("ports past the limit collapse into an overflow button", async () => {
    const onOverflow = vi.fn();
    render(
      <PortChips
        ports={[p({ host_port: 8080 }), p({ host_port: 3000, container_port: 3000 }), p({ host_port: 9000, container_port: 9000 })]}
        sessionId="s1"
        isRemote
        limit={2}
        onOverflow={onOverflow}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "+1" }));
    expect(onOverflow).toHaveBeenCalled();
    expect(reach).not.toHaveBeenCalled();
  });

  test("a failed reach toasts and leaves the chip clickable again", async () => {
    reach.mockRejectedValueOnce(new Error("session gone"));
    render(<PortChips ports={[p({ host_port: 8080 })]} sessionId="s1" isRemote />);
    const chip = screen.getByRole("button", { name: /8080/ }) as HTMLButtonElement;
    await userEvent.click(chip);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("session gone"), { severity: "error" }));
    expect(chip.disabled).toBe(false);
  });
});
