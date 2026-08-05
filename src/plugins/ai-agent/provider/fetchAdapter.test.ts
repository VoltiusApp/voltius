import { describe, test, expect, vi } from "vitest";
import { makeStreamFetch } from "./fetchAdapter";

function fakeApi() {
  const stream = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  return { api: { http: { stream } } as any, stream };
}

describe("makeStreamFetch", () => {
  test("string url passes straight through to http.stream", async () => {
    const { api, stream } = fakeApi();
    const f = makeStreamFetch(api);
    const init = { method: "POST", body: "{}" };
    await f("https://api.example/v1/messages", init);
    expect(stream).toHaveBeenCalledWith("https://api.example/v1/messages", init);
  });

  test("URL object is stringified", async () => {
    const { api, stream } = fakeApi();
    const f = makeStreamFetch(api);
    await f(new URL("https://api.example/x"));
    expect(stream).toHaveBeenCalledWith("https://api.example/x", undefined);
  });

  test("Request input is decomposed into url + init", async () => {
    const { api, stream } = fakeApi();
    const f = makeStreamFetch(api);
    await f(new Request("https://api.example/y", { method: "POST", headers: { "x-a": "1" }, body: "hi" }));
    expect(stream).toHaveBeenCalledTimes(1);
    const [url, init] = stream.mock.calls[0];
    expect(url).toBe("https://api.example/y");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-a")).toBe("1");
  });
});
