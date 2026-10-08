import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    lost: (() => void) | null = null;
    disposed = false;
    onContextLoss(fn: () => void) { this.lost = fn; return { dispose() {} }; }
    dispose() { this.disposed = true; }
  },
}));

const { claimWebglRenderer } = await import("@/utils/webglAddon");

type FakeAddon = { lost: (() => void) | null; disposed: boolean; dispose(): void };

function fakeTerminal() {
  const addons: FakeAddon[] = [];
  const term = { loadAddon: (a: FakeAddon) => addons.push(a) } as unknown as Terminal;
  const live = () => addons.filter((a) => !a.disposed);
  return { term, addons, live };
}

describe("claimWebglRenderer", () => {
  it("keeps at most 8 WebGL terminals, evicting the least recently claimed", () => {
    const terms = Array.from({ length: 9 }, fakeTerminal);
    terms.slice(0, 8).forEach((t) => claimWebglRenderer(t.term));
    claimWebglRenderer(terms[0].term);
    claimWebglRenderer(terms[8].term);

    expect(terms[0].live()).toHaveLength(1);
    expect(terms[1].live()).toHaveLength(0);
    expect(terms[8].live()).toHaveLength(1);
    expect(terms[0].addons).toHaveLength(1);

    terms.forEach((t) => t.live().forEach((a) => a.dispose()));
  });

  it("drops a terminal whose context the engine took and reloads WebGL on its next claim", () => {
    const t = fakeTerminal();
    claimWebglRenderer(t.term);
    t.addons[0].lost!();
    expect(t.live()).toHaveLength(0);

    claimWebglRenderer(t.term);
    expect(t.live()).toHaveLength(1);
    expect(t.addons).toHaveLength(2);
    t.live()[0].dispose();
  });

  it("frees the slot when the terminal itself disposes the addon", () => {
    const first = fakeTerminal();
    claimWebglRenderer(first.term);
    first.addons[0].dispose();

    const others = Array.from({ length: 8 }, fakeTerminal);
    others.forEach((t) => claimWebglRenderer(t.term));
    expect(others.every((t) => t.live().length === 1)).toBe(true);
    others.forEach((t) => t.live().forEach((a) => a.dispose()));
  });
});
