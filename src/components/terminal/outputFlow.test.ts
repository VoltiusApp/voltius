import { describe, expect, it, vi } from "vitest";
import { createOutputFlow } from "./outputFlow";

describe("createOutputFlow", () => {
  it("pauses once when pending output crosses the high-water mark", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused, 100, 20);
    flow.written(60);
    expect(setPaused).not.toHaveBeenCalled();
    flow.written(60);
    flow.written(60);
    expect(setPaused.mock.calls).toEqual([[true]]);
  });

  it("resumes once the backlog drains below the low-water mark", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused, 100, 20);
    flow.written(150);
    flow.processed(100);
    expect(setPaused.mock.calls).toEqual([[true]]);
    flow.processed(40);
    flow.processed(10);
    expect(setPaused.mock.calls).toEqual([[true], [false]]);
  });

  it("never pauses while output keeps up", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused, 100, 20);
    for (let i = 0; i < 50; i++) {
      flow.written(90);
      flow.processed(90);
    }
    expect(setPaused).not.toHaveBeenCalled();
  });
});
