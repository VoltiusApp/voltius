import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProviderLogo } from "./ProviderLogo";
import type { ProviderKind } from "../types";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
afterEach(cleanup);

const KINDS = ["anthropic", "openai-compatible", "ollama", "google"] as const satisfies readonly ProviderKind[];

function renderMarkup(kind: ProviderKind): string {
  const { container } = render(<ProviderLogo kind={kind} />);
  const markup = container.querySelector("svg")?.innerHTML;
  expect(markup).toBeTruthy();
  return markup as string;
}

describe("ProviderLogo", () => {
  it.each(KINDS)("renders a mark for %s", (kind) => {
    render(<ProviderLogo kind={kind} />);
    expect(screen.getByTestId(`provider-logo-${kind}`)).toBeTruthy();
  });

  it("renders a pairwise distinct mark for every provider kind", () => {
    const markupByKind = KINDS.map((kind) => [kind, renderMarkup(kind)] as const);

    for (let i = 0; i < markupByKind.length; i++) {
      for (let j = i + 1; j < markupByKind.length; j++) {
        const [kindA, markupA] = markupByKind[i];
        const [kindB, markupB] = markupByKind[j];
        expect(markupA, `${kindA} and ${kindB} rendered identical markup`).not.toBe(markupB);
      }
    }
  });

  it("renders Anthropic's brand clay fill", () => {
    const markup = renderMarkup("anthropic");
    expect(markup).toContain("#D97757");
  });

  it("renders OpenAI's mark as a circle-bearing glyph", () => {
    const { container } = render(<ProviderLogo kind="openai-compatible" />);
    expect(container.querySelector("svg circle")).toBeTruthy();
  });

  it("renders Gemini's mark (kind \"google\") with its brand gradient", () => {
    const { container } = render(<ProviderLogo kind="google" />);
    expect(container.querySelector("svg linearGradient")).toBeTruthy();
  });

  it("renders Ollama's mark as a monochrome currentColor glyph with no circle", () => {
    const { container } = render(<ProviderLogo kind="ollama" />);
    const svg = container.querySelector("svg");
    expect(svg?.innerHTML).toContain("currentColor");
    expect(svg?.querySelector("circle")).toBeFalsy();
  });
});
