import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FileEntry } from "./SFTPTypes";

const sftpOwners = vi.fn();
const sftpSetAttrs = vi.fn();
const fsOwners = vi.fn();
const fsSetAttrs = vi.fn();
vi.mock("@/services/sftp", () => ({
  sftpOwners: (...a: unknown[]) => sftpOwners(...a),
  sftpSetAttrs: (...a: unknown[]) => sftpSetAttrs(...a),
  fsOwners: (...a: unknown[]) => fsOwners(...a),
  fsSetAttrs: (...a: unknown[]) => fsSetAttrs(...a),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${String(opts.count)}` : key,
  }),
}));

import { PermissionsDialog } from "./PermissionsDialog";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());
beforeEach(() => {
  sftpOwners.mockReset();
  sftpSetAttrs.mockReset().mockResolvedValue(undefined);
  fsOwners.mockReset();
  fsSetAttrs.mockReset().mockResolvedValue(undefined);
});

const file = (name: string, permissions: number, isDir = false): FileEntry => ({
  name, path: `/srv/${name}`, size: 0, isDir, permissions,
});

const voltius = { uid: 1000, gid: 100, user: "voltius", group: "users" };

function open(files: FileEntry[], sftpId: string | null = "s1") {
  const onApplied = vi.fn();
  render(<PermissionsDialog sftpId={sftpId} files={files} onClose={vi.fn()} onApplied={onApplied} />);
  return { onApplied };
}

const applyButton = () => screen.getAllByRole("button").slice(-1)[0];
const toggleRecurse = () =>
  fireEvent.click(screen.getByText("fileTransfer.permissions.recurse").querySelector(".checkbox-box")!);
const ownerInput = () => screen.getByLabelText("fileTransfer.permissions.owner") as HTMLInputElement;

describe("PermissionsDialog", () => {
  it("applies the grid's settled bits and leaves mixed ones and unchanged owners alone", async () => {
    sftpOwners.mockResolvedValue([voltius, voltius]);
    const { onApplied } = open([file("releases", 0o775, true), file("shared", 0o750, true)]);
    await waitFor(() => expect(ownerInput().value).toBe("voltius"));

    fireEvent.click(applyButton());

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(sftpSetAttrs).toHaveBeenCalledWith("s1", {
      paths: ["/srv/releases", "/srv/shared"], set: 0o750, clear: 0o002,
      owner: undefined, group: undefined, recurse: undefined,
    });
  });

  it("sends a new owner and the recursion scope", async () => {
    sftpOwners.mockResolvedValue([voltius]);
    open([file("app", 0o755, true)]);
    await waitFor(() => expect(ownerInput().disabled).toBe(false));

    fireEvent.change(ownerInput(), { target: { value: "www-data" } });
    toggleRecurse();
    fireEvent.click(screen.getByText("fileTransfer.permissions.scopeFiles"));
    fireEvent.click(applyButton());

    await waitFor(() => expect(sftpSetAttrs).toHaveBeenCalled());
    expect(sftpSetAttrs.mock.lastCall![1]).toMatchObject({ owner: "www-data", group: undefined, recurse: "files" });
  });

  it("updates the grid from a typed octal mode", async () => {
    sftpOwners.mockResolvedValue([voltius]);
    open([file("deploy.sh", 0o644)]);
    fireEvent.change(screen.getByLabelText("fileTransfer.permissions.octal"), { target: { value: "755" } });
    expect(screen.getByText("rwxr-xr-x")).toBeTruthy();

    fireEvent.click(applyButton());
    await waitFor(() => expect(sftpSetAttrs).toHaveBeenCalled());
    expect(sftpSetAttrs.mock.lastCall![1]).toMatchObject({ set: 0o755, clear: 0o022 });
  });

  it("without a shell on the host, locks ownership and recursion and says why", async () => {
    sftpOwners.mockResolvedValue(null);
    open([file("app", 0o755, true)]);
    await screen.findByText("fileTransfer.permissions.noShell");
    expect(ownerInput().disabled).toBe(true);

    toggleRecurse();
    fireEvent.click(applyButton());
    await waitFor(() => expect(sftpSetAttrs).toHaveBeenCalled());
    expect(sftpSetAttrs.mock.lastCall![1]).toMatchObject({ owner: undefined, recurse: undefined });
  });

  it("keeps the dialog open and shows the host's error", async () => {
    sftpOwners.mockResolvedValue([voltius]);
    sftpSetAttrs.mockRejectedValue(new Error("chown: Operation not permitted"));
    const { onApplied } = open([file("deploy.sh", 0o755)]);
    fireEvent.change(ownerInput(), { target: { value: "root" } });
    fireEvent.click(applyButton());

    await screen.findByText(/Operation not permitted/);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("changes files on this machine through the local commands", async () => {
    fsOwners.mockResolvedValue([voltius]);
    const { onApplied } = open([file("deploy.sh", 0o644)], null);
    await waitFor(() => expect(ownerInput().value).toBe("voltius"));
    expect(fsOwners).toHaveBeenCalledWith(["/srv/deploy.sh"]);

    fireEvent.change(screen.getByLabelText("fileTransfer.permissions.octal"), { target: { value: "755" } });
    fireEvent.click(applyButton());

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(fsSetAttrs.mock.lastCall![0]).toMatchObject({ paths: ["/srv/deploy.sh"], set: 0o755, clear: 0o022 });
    expect(sftpOwners).not.toHaveBeenCalled();
    expect(sftpSetAttrs).not.toHaveBeenCalled();
  });
});
