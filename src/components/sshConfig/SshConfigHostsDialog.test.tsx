import "@/i18n";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSshConfigStore } from "@/stores/sshConfigStore";
import { useVaultStore } from "@/stores/vaultStore";
import { Modal } from "@/components/shared/Modal";

const activate = vi.fn(async (..._a: unknown[]) => {});
const loadPreview = vi.fn();
const linkAgain = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/services/sshConfig/link", () => ({
  loadPreview: (...a: unknown[]) => loadPreview(...a),
  preview: async () => ({
    rows: [
      { kind: "link", alias: "prod-web", target: "deploy@10.0.0.11:22", reason: "legacy", connectionId: "c1", connectionName: "Prod Web", identityName: "Work" },
      { kind: "create", alias: "gcp-1", target: "kiki@34.0.0.9:22" },
      { kind: "ambiguous", alias: "homelab", target: "root@192.168.1.10:22", candidates: ["Homelab", "NAS"] },
      { kind: "skipped", alias: "coder", target: "coder", reason: "proxyCommand" },
    ],
    keys: [
      { name: "google_compute_engine", path: "~/.ssh/google_compute_engine", state: { copy: "copy", ref: "notCopied" } },
      { name: "id_ed25519_work", path: "~/.ssh/id_ed25519_work", state: { copy: "exists", ref: "exists" } },
    ],
  }),
  activate: (...a: unknown[]) => activate(...a),
  linkAgain: (...a: unknown[]) => linkAgain(...a),
}));

import { SshConfigHostsDialog } from "./SshConfigHostsDialog";

afterEach(cleanup);
beforeEach(async () => {
  activate.mockReset();
  linkAgain.mockClear();
  const { preview } = (await import("@/services/sshConfig/link")) as unknown as { preview: () => Promise<unknown> };
  loadPreview.mockReset().mockImplementation(preview);
  useVaultStore.setState({ vaults: [{ id: "lab", name: "Lab" }, { id: "team-v", name: "Team", teamId: "t1" }] as never });
  useSshConfigStore.setState({ state: {}, status: { skipped: [] }, dialog: "activate" });
});

describe("SshConfigHostsDialog", () => {
  it("shows no separator for a row without a target", async () => {
    loadPreview.mockResolvedValueOnce({ rows: [{ kind: "skipped", alias: "Host *.corp", target: "", reason: "pattern" }], keys: [] });
    render(<SshConfigHostsDialog />);
    expect((await screen.findByText("Host *.corp")).parentElement!.textContent).not.toContain("·");
  });

  it("stacks above a modal that opens in the same render", async () => {
    render(<Modal onClose={() => {}}><SshConfigHostsDialog /></Modal>);
    await screen.findByText("prod-web");
    const layers = [...document.body.children].filter((el) => el.querySelector("[role=dialog]"));
    expect(layers[layers.length - 1].textContent).toContain("prod-web");
  });

  it("activates with the checked links only", async () => {
    render(<SshConfigHostsDialog />);
    fireEvent.click(await screen.findByText("prod-web"));
    expect(screen.getByText(/ignored/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
    expect(activate).toHaveBeenCalledWith({ links: [], ignored: [{ alias: "prod-web", connectionId: "c1" }], creates: ["gcp-1", "homelab"] }, "personal", true);
  });

  it("lists the keys and lets the user keep private keys out of the vault", async () => {
    render(<SshConfigHostsDialog />);
    expect(await screen.findByText("google_compute_engine")).toBeTruthy();
    expect(screen.getByText(/will be copied/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /copy private keys/i }));
    expect(screen.getByText(/not copied/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
    expect(activate).toHaveBeenCalledWith({ links: [{ alias: "prod-web", connectionId: "c1" }], ignored: [], creates: ["gcp-1", "homelab"] }, "personal", false);
  });

  it("explains ambiguous and skipped rows", async () => {
    render(<SshConfigHostsDialog />);
    expect(await screen.findByText(/Homelab, NAS/)).toBeTruthy();
    expect(screen.getByText(/ProxyCommand/)).toBeTruthy();
  });

  it("warns that a linked host's identity gives way to the file's key", async () => {
    render(<SshConfigHostsDialog />);
    expect(await screen.findByText("The identity “Work” will be replaced by the file's key")).toBeTruthy();
  });

  it("activates into the personal vault picked in the header", async () => {
    render(<SshConfigHostsDialog />);
    await screen.findByText("prod-web");
    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(screen.queryByText("Team")).toBeNull();
    fireEvent.click(screen.getByText("Lab"));
    await waitFor(() => expect(loadPreview).toHaveBeenLastCalledWith("activate", "lab"));
    const turnOn = screen.getByRole("button", { name: /turn on/i }) as HTMLButtonElement;
    await waitFor(() => expect(turnOn.disabled).toBe(false));
    expect(screen.getByText(/Copied keys go to Lab/)).toBeTruthy();
    fireEvent.click(turnOn);
    expect(activate.mock.lastCall![1]).toBe("lab");
  });

  it("cannot turn on before the preview has loaded, nor after it failed", async () => {
    let resolve!: (v: unknown) => void;
    loadPreview.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<SshConfigHostsDialog />);
    const turnOn = (await screen.findByRole("button", { name: /turn on/i })) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    resolve({ rows: [{ kind: "create", alias: "gcp-1", target: "kiki@34.0.0.9:22" }], keys: [] });
    await waitFor(() => expect(turnOn.disabled).toBe(false));
    cleanup();

    loadPreview.mockRejectedValueOnce(new Error("cannot read"));
    render(<SshConfigHostsDialog />);
    expect(await screen.findByText("cannot read")).toBeTruthy();
    expect((screen.getByRole("button", { name: /turn on/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show the rows of a previous opening while the new preview loads", async () => {
    const { rerender } = render(<SshConfigHostsDialog />);
    await screen.findByText("prod-web");
    act(() => useSshConfigStore.setState({ dialog: null }));
    loadPreview.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useSshConfigStore.setState({ dialog: "activate" }));
    rerender(<SshConfigHostsDialog />);
    await screen.findByRole("button", { name: /turn on/i });
    expect(screen.queryByText("prod-web")).toBeNull();
  });

  it("keeps the preview open and shows why turning on failed", async () => {
    activate.mockRejectedValueOnce(new Error("disk full"));
    render(<SshConfigHostsDialog />);
    await screen.findByText("prod-web");
    fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(useSshConfigStore.getState().dialog).toBe("activate");
  });

  it("reviews managed and detached hosts without activation controls", async () => {
    loadPreview.mockResolvedValue({
      rows: [
        { kind: "managed", alias: "web", target: "10.0.0.1:22", connectionName: "Web" },
        { kind: "detached", alias: "db", target: "10.0.0.2:22", connectionId: "c2", connectionName: "DB", deleted: false },
        { kind: "detached", alias: "old", target: "10.0.0.3:22", connectionId: "c3", connectionName: "old", deleted: true },
      ],
      keys: [],
    });
    useSshConfigStore.setState({ dialog: "review" });
    const { container } = render(<SshConfigHostsDialog />);
    await screen.findByText("web");
    expect(container.querySelector(".checkbox-box")).toBeNull();
    expect(screen.queryByRole("button", { name: /turn on/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vault" })).toBeNull();
    const loads = loadPreview.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Link again" }));
    expect(linkAgain).toHaveBeenLastCalledWith("c2");
    await waitFor(() => expect(loadPreview.mock.calls.length).toBe(loads + 1));
    fireEvent.click(screen.getByRole("button", { name: "Recreate" }));
    expect(linkAgain).toHaveBeenLastCalledWith("c3");
    await waitFor(() => expect(loadPreview.mock.calls.length).toBe(loads + 2));
  });
});
