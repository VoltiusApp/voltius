import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RichText } from "./RichText";
import type { ObjectRefResolver } from "./useObjectRefs";
import type { ObjectRef } from "../state/objectRefs";

vi.mock("./ObjectRefChip", () => ({ ObjectRefChip: ({ id }: { id: string }) => <b data-testid="chip">{id}</b> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ref: ObjectRef = {
  kind: "connection", id: "conn_1", name: "Prod", detail: "u@h:22", ambiguous: false,
  connection: { id: "conn_1", name: "Prod", host: "h", port: 22, username: "u", auth_type: "key", tags: [] },
};
const refs: ObjectRefResolver = { resolve: () => ref, knownIds: new Set(["conn_1"]), loading: false };

describe("RichText", () => {
  it("renders text with an inline chip for a known id", () => {
    render(<RichText text="open conn_1 now" refs={refs} />);
    expect(screen.getByTestId("chip").textContent).toBe("conn_1");
    expect(screen.getByText(/open/)).toBeTruthy();
    expect(screen.getByText(/now/)).toBeTruthy();
  });

  it("renders plain text with no chip when there are no ids", () => {
    render(<RichText text="just words" refs={{ ...refs, knownIds: new Set() }} />);
    expect(screen.queryByTestId("chip")).toBeNull();
    expect(screen.getByText("just words")).toBeTruthy();
  });
});

it("abbreviates a UUID that resolves to nothing, keeping it in the title", () => {
  const refs = { resolve: () => null, knownIds: new Set<string>(), loading: false };
  const id = "a82ff8e0-949f-4601-94a4-12d90247abad";
  render(<RichText text={`session ${id} closed`} refs={refs} />);
  const abbr = screen.getByTitle(id);
  expect(abbr.textContent).toBe("a82ff8e0…");
  expect(document.body.textContent).toContain("closed");
});
