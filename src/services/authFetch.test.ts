import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  appFetch: vi.fn(),
  getJwt: vi.fn(),
  expiring: vi.fn(),
  tryRefreshJwt: vi.fn(),
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/authTokens", () => ({
  getJwt: h.getJwt,
  isJwtExpiredOrExpiring: h.expiring,
  tryRefreshJwt: h.tryRefreshJwt,
}));
vi.mock("@/services/clientHeaders", () => ({ clientHeaders: async () => ({}) }));

import { fetchAuth } from "./authFetch";

const ok = () => new Response("{}", { status: 200 });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.getJwt.mockResolvedValue("jwt");
  h.expiring.mockReturnValue(false);
});

test("requests go through the app's fetch unless another one is given", async () => {
  h.appFetch.mockResolvedValue(ok());

  await fetchAuth("https://s/x");

  expect(h.appFetch).toHaveBeenCalledTimes(1);
});

test("a given fetch carries the request, the retry after a 401 and the token refresh", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(ok());
  h.tryRefreshJwt.mockResolvedValue("fresh");

  const res = await fetchAuth("https://s/x", {}, { fetchImpl });

  expect(res.status).toBe(200);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(h.appFetch).not.toHaveBeenCalled();
  expect(h.tryRefreshJwt).toHaveBeenCalledWith(fetchImpl);
});

test("an expiring token is refreshed through the given fetch before the request", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(ok());
  h.expiring.mockReturnValue(true);
  h.tryRefreshJwt.mockResolvedValue("fresh");

  await fetchAuth("https://s/x", {}, { fetchImpl });

  expect(h.tryRefreshJwt).toHaveBeenCalledWith(fetchImpl);
});
