import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProviderLogo } from "./ProviderLogo";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
afterEach(cleanup);

describe("ProviderLogo", () => {
  it.each(["anthropic", "openai-compatible", "ollama", "google"] as const)("renders a mark for %s", (kind) => {
    render(<ProviderLogo kind={kind} />);
    expect(screen.getByTestId(`provider-logo-${kind}`)).toBeTruthy();
  });
});
