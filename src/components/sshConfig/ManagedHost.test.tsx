import "@/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSshConfigStore } from "@/stores/sshConfigStore";

const detach = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/services/sshConfig/link", () => ({ detach: (...a: unknown[]) => detach(...a) }));
import { ManagedBadge, ManagedBanner } from "./ManagedHost";

afterEach(cleanup);
beforeEach(() => {
  detach.mockClear();
  useSshConfigStore.setState({
    state: { managed: { c1: { alias: "prod-web", at: 1, devices: {} }, c2: { alias: "x", at: 1, gone: "detached", devices: {} } } },
    status: { skipped: [] },
    dialog: null,
  });
});

describe("managed host UI", () => {
  it("shows the badge and banner for a live entry only", () => {
    const { container } = render(<><ManagedBadge id="c2" /><ManagedBanner id="c2" /></>);
    expect(container.textContent).toBe("");
    render(<ManagedBanner id="c1" />);
    expect(screen.getByText("prod-web")).toBeTruthy();
  });

  it("detaches from the banner", () => {
    render(<ManagedBanner id="c1" />);
    fireEvent.click(screen.getByRole("button", { name: /detach/i }));
    expect(detach).toHaveBeenCalledWith(["c1"]);
  });
});
