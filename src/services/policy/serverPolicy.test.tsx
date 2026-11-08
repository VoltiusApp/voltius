// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn(async () => "linux") }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));

import { usePolicyStore } from "@/stores/policyStore";
import { ServerUrlField } from "@/components/shared/ServerUrlField";
import { initialServerUrl, policyServerUrl, resolveServerUrl, serverAllowed } from "./serverPolicy";

const NONE = { policy: {}, defaults: {} };
const set = (policy: Record<string, unknown>, defaults: Record<string, unknown> = {}) =>
  usePolicyStore.setState({ machine: { policy, defaults }, server: NONE });

beforeEach(() => usePolicyStore.setState({ machine: NONE, server: NONE }));
afterEach(cleanup);

describe("initialServerUrl", () => {
  it("prefers the locked url", () => {
    set({ "server.url": "https://sync.corp.example/" }, { "server.url": "https://d.example" });
    expect(policyServerUrl()).toBe("https://sync.corp.example");
    expect(initialServerUrl("https://last.example")).toBe("https://sync.corp.example");
  });
  it("then the last server", () => {
    set({}, { "server.url": "https://d.example" });
    expect(initialServerUrl("https://last.example")).toBe("https://last.example");
  });
  it("then the admin default", () => {
    set({}, { "server.url": "https://d.example" });
    expect(initialServerUrl("")).toBe("https://d.example");
  });
  it("then falls back to last", () => {
    expect(initialServerUrl("")).toBe("");
  });
});

describe("resolveServerUrl", () => {
  it("pins to the locked url, else trims the input", () => {
    expect(resolveServerUrl("https://x.example///")).toBe("https://x.example");
    set({ "server.url": "https://sync.corp.example" });
    expect(resolveServerUrl("https://x.example")).toBe("https://sync.corp.example");
  });
});

describe("serverAllowed", () => {
  const corp = "https://sync.corp.example";
  it("allows everything when unlocked", () => {
    expect(serverAllowed("https://other.example")).toBe(true);
  });
  it("allows when locked and allowOther unset", () => {
    set({ "server.url": corp });
    expect(serverAllowed("https://other.example")).toBe(true);
  });
  it("allows the same host and rejects another when allowOther is false", () => {
    set({ "server.url": corp, "server.allowOther": false });
    expect(serverAllowed(`${corp}/`)).toBe(true);
    expect(serverAllowed("https://other.example")).toBe(false);
  });
  it("rejects a look-alike of the locked server", () => {
    set({ "server.url": "https://api.acme.com", "server.allowOther": false });
    expect(serverAllowed("http://acme.com")).toBe(false);
    expect(serverAllowed("https://api.acme.com:8443")).toBe(false);
  });
  it("always allows local accounts", () => {
    set({ "server.url": corp, "server.allowOther": false });
    expect(serverAllowed(null)).toBe(true);
  });
});

describe("ServerUrlField locked", () => {
  it("shows no input", () => {
    const { container } = render(
      <ServerUrlField value="https://sync.corp.example" onChange={() => {}} inputClassName="" locked />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("common.policy.managed");
  });
});
