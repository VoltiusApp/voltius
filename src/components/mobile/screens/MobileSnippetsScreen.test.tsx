// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBackStackStore } from "@/hooks/useBackInterceptor";
import type { CatalogEntry } from "@/services/snippetCatalog";
import MobileSnippetsScreen from "./MobileSnippetsScreen";

const entry: CatalogEntry = {
  id: "docker-pack",
  kind: "pack",
  name: "Docker essentials",
  author: "voltius",
  tags: ["docker"],
  snippets: [{ _eid: "ps", name: "List containers", steps: [{ kind: "script", content: "docker ps" }] } as CatalogEntry["snippets"][number]],
};

vi.mock("../MobileHeader", () => ({ default: () => null }));
vi.mock("../MobileSnippetList", () => ({ default: () => <div data-testid="mine-list" /> }));
vi.mock("@/services/snippetCatalogFetch", () => ({ fetchCatalog: async () => ({ entries: [entry], fromCache: false }) }));
afterEach(cleanup);

test("Community tab lists the catalogue and Android back closes an open entry", async () => {
  const { container } = render(<MobileSnippetsScreen />);
  expect(screen.getByTestId("mine-list")).toBeTruthy();

  fireEvent.click(container.querySelector('[data-mobile-snippets-tab="community"]')!);
  fireEvent.click(await screen.findByText("Docker essentials"));
  expect(await screen.findByText("List containers")).toBeTruthy();

  const interceptors = useBackStackStore.getState().stack;
  expect(interceptors).toHaveLength(1);
  act(() => interceptors[0].close());
  expect(screen.queryByText("List containers")).toBeNull();
  expect(screen.getByText("Docker essentials")).toBeTruthy();
});
