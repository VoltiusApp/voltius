import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Iconify loads icon data asynchronously; its timers can outlive this file's
// jsdom teardown and throw in whichever test runs next (see other *.test.tsx
// files in this repo for the same workaround).
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));

const prune = {
  images: vi.fn(async () => "reclaimed 1GB"),
  networks: vi.fn(async () => "reclaimed 2 networks"),
  volumes: vi.fn(async () => "reclaimed 3 volumes"),
};
const remove = {
  network: vi.fn(async () => {}),
  volume: vi.fn(async () => {}),
};

vi.mock("../services", () => ({
  dockerPruneImages: (...a: unknown[]) => prune.images(...(a as [])),
  dockerPruneNetworks: (...a: unknown[]) => prune.networks(...(a as [])),
  dockerPruneVolumes: (...a: unknown[]) => prune.volumes(...(a as [])),
  dockerRemoveNetwork: (...a: unknown[]) => remove.network(...(a as [])),
  dockerRemoveVolume: (...a: unknown[]) => remove.volume(...(a as [])),
  dockerRemoveImage: vi.fn(async () => {}),
}));
vi.mock("../runtime", () => ({ getDockerApi: () => null }));
vi.mock("../useImageUpdates", () => ({
  checkableImage: (t?: string) => t ?? null,
  useImageUpdates: () => ({
    statuses: {},
    checking: new Set(),
    settings: {},
    runChecks: vi.fn(),
    checkAll: vi.fn(),
  }),
}));
vi.mock("../updateActions", () => ({ pullAndMaybeRecreate: vi.fn() }));

import { NetworkList } from "./NetworkList";
import { VolumeList } from "./VolumeList";
import { ImageList } from "./ImageList";

const ctx = { sessionId: "s1", isRemote: false, localShell: null };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("the docker resource lists", () => {
  it("counts its rows in the toolbar and names the resource", () => {
    render(
      <NetworkList
        networks={[{ id: "abcdef1234567890", name: "bridge", driver: "bridge" } as never]}
        {...ctx}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("1 networks")).toBeTruthy();
  });

  it("shows its own empty state when there is nothing to list", () => {
    render(<VolumeList volumes={[]} {...ctx} onRefresh={vi.fn()} />);
    expect(screen.getByText("No volumes")).toBeTruthy();
  });

  it("disables prune while it runs, then shows the daemon's message and refreshes", async () => {
    const onRefresh = vi.fn();
    let release!: (v: string) => void;
    prune.volumes.mockImplementationOnce(() => new Promise<string>((r) => (release = r)));

    render(<VolumeList volumes={[]} {...ctx} onRefresh={onRefresh} />);
    const button = screen.getByRole("button", { name: /prune/ });
    await userEvent.click(button);

    expect(screen.getByRole("button", { name: /pruning…/ })).toHaveProperty("disabled", true);
    expect(onRefresh).not.toHaveBeenCalled();

    release("reclaimed 3 volumes");
    await waitFor(() => expect(screen.getByText("reclaimed 3 volumes")).toBeTruthy());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^prune$/ })).toHaveProperty("disabled", false);
  });

  it("shows a failed prune in the same slot and does not refresh", async () => {
    const onRefresh = vi.fn();
    prune.networks.mockRejectedValueOnce(new Error("daemon down"));

    render(<NetworkList networks={[]} {...ctx} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole("button", { name: /prune/ }));

    await waitFor(() => expect(screen.getByText(/daemon down/)).toBeTruthy());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("passes the connection context to the prune call", async () => {
    render(<ImageList images={[]} {...ctx} onRefresh={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^prune$/ }));
    await waitFor(() => expect(prune.images).toHaveBeenCalledWith(ctx));
  });

  it("keeps the images toolbar's own check-updates action beside prune", () => {
    render(<ImageList images={[]} {...ctx} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: /check updates/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^prune$/ })).toBeTruthy();
  });

  it("removes a row through the resource's own remove call and refreshes", async () => {
    const onRefresh = vi.fn();
    render(
      <VolumeList
        volumes={[{ name: "data", driver: "local" } as never]}
        {...ctx}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(screen.getByTitle("Remove volume"));
    await waitFor(() => expect(remove.volume).toHaveBeenCalledWith(ctx, "data"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when a row removal fails", async () => {
    const onRefresh = vi.fn();
    remove.network.mockRejectedValueOnce(new Error("in use"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <NetworkList
        networks={[{ id: "abcdef1234567890", name: "bridge", driver: "bridge" } as never]}
        {...ctx}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(screen.getByTitle("Remove network"));
    await waitFor(() => expect(remove.network).toHaveBeenCalled());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows a network's truncated id beside its driver", () => {
    render(
      <NetworkList
        networks={[{ id: "abcdef1234567890", name: "bridge", driver: "bridge" } as never]}
        {...ctx}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("abcdef123456")).toBeTruthy();
  });
});
