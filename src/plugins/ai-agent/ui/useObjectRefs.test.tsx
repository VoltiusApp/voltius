import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { useObjectRefs } from "./useObjectRefs";
import * as store from "../state/agentStore";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Probe() {
  const { resolve, knownIds, loading } = useObjectRefs();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="known">{[...knownIds].join(",")}</span>
      <span data-testid="name">{resolve("c1")?.name ?? "-"}</span>
    </div>
  );
}

it("loads connections once and exposes resolve + knownIds", async () => {
  vi.spyOn(store, "getAgentDeps").mockReturnValue({
    api: { connections: { list: () => Promise.resolve([
      { id: "c1", name: "Prod", host: "h", port: 22, username: "u", auth_type: "key", tags: [] },
    ]) } },
  } as unknown as ReturnType<typeof store.getAgentDeps>);

  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
  expect(screen.getByTestId("known").textContent).toBe("c1");
  expect(screen.getByTestId("name").textContent).toBe("Prod");
});

it("settles to empty (loading false) when there is no plugin api", async () => {
  vi.spyOn(store, "getAgentDeps").mockReturnValue(null);
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
  expect(screen.getByTestId("name").textContent).toBe("-");
});
