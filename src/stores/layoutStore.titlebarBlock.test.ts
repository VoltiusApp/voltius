import { describe, it, expect, beforeEach } from "vitest";
import { useLayoutStore } from "./layoutStore";

const groupOf = (key: string) => (key.startsWith("session:w") ? "web" : undefined);

beforeEach(() => useLayoutStore.setState({ titlebarOrder: [] }));

describe("titlebar blocks", () => {
  it("gathers a host's keys behind its first key when a group function is given", () => {
    useLayoutStore.getState().syncTitlebarOrder(["session:w1", "session:d1", "session:w2"], groupOf);
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:w2", "session:d1"]);
  });

  it("keeps the flat merge when no group function is given", () => {
    useLayoutStore.getState().syncTitlebarOrder(["session:w1", "session:d1", "session:w2"]);
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:d1", "session:w2"]);
  });

  it("moves several keys as one block", () => {
    useLayoutStore.setState({ titlebarOrder: ["session:d1", "session:w1", "session:w2", "session:x"] });
    useLayoutStore.getState().reorderTitlebarItem(["session:w1", "session:w2"], "session:d1", "before");
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:w2", "session:d1", "session:x"]);
  });

  it("ignores a drop onto one of the moving keys", () => {
    useLayoutStore.setState({ titlebarOrder: ["session:w1", "session:w2"] });
    useLayoutStore.getState().reorderTitlebarItem(["session:w1", "session:w2"], "session:w2", "after");
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:w2"]);
  });
});
