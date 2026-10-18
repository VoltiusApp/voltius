import { test, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ fetchServerMeta: vi.fn(), serverUrl: null as string | null }));
vi.mock("@/services/teamObjects", () => ({ fetchServerMeta: h.fetchServerMeta }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: async () => h.serverUrl }));
vi.mock("@/lib/logger", () => ({ logFailure: () => vi.fn() }));

import { resetServerCapabilities, useServerBillingEnabled } from "./serverCapabilities";

beforeEach(() => {
  h.fetchServerMeta.mockReset();
  h.serverUrl = null;
  resetServerCapabilities();
});

test("billing is on only once the server says so", async () => {
  h.fetchServerMeta.mockResolvedValue({ self_hosted: false, billing_enabled: true });
  const { result } = renderHook(() => useServerBillingEnabled());
  expect(result.current).toBe(false);
  await waitFor(() => expect(result.current).toBe(true));
});

test("a self-hosted server keeps billing off", async () => {
  h.fetchServerMeta.mockResolvedValue({ self_hosted: true, billing_enabled: false });
  const { result } = renderHook(() => useServerBillingEnabled());
  await waitFor(() => expect(h.fetchServerMeta).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

test("an unreachable self-hosted server keeps billing off", async () => {
  h.serverUrl = "https://voltius.example.com";
  h.fetchServerMeta.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useServerBillingEnabled());
  await waitFor(() => expect(h.fetchServerMeta).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(result.current).toBe(false);
});

test("an unreachable official cloud keeps its billing UI", async () => {
  h.serverUrl = "https://api.voltius.app";
  h.fetchServerMeta.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useServerBillingEnabled());
  await waitFor(() => expect(result.current).toBe(true));
});
