import { describe, expect, it, vi } from "vitest";
import { createHistoryAPI, type HistoryPorts } from "./history";

const e = (id: string, command: string, over: Partial<Record<string, unknown>> = {}) => ({
  id, command, timestamp: Number(id), sessionId: "s-1", sessionName: "web-01", connectionId: "c-1", ...over,
});

function makePorts(entries = [e("1", "ls -la"), e("2", "systemctl restart nginx"), e("3", "df -h", { connectionId: "c-2", sessionId: "s-2" })]) {
  const ports: HistoryPorts = { list: vi.fn(() => entries) };
  return ports;
}

describe("history domain", () => {
  it("returns newest first and projects snake_case fields", () => {
    const api = createHistoryAPI(makePorts());
    const res = api.search({});
    expect(res.map((r) => r.id)).toEqual(["3", "2", "1"]);
    expect(res[0]).toEqual({
      id: "3", command: "df -h", timestamp: 3,
      session_id: "s-2", session_name: "web-01", connection_id: "c-2",
    });
  });

  it("matches the query case-insensitively on the command text", () => {
    const api = createHistoryAPI(makePorts());
    expect(api.search({ query: "NGINX" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by connection and by session", () => {
    const api = createHistoryAPI(makePorts());
    expect(api.search({ connectionId: "c-1" }).map((r) => r.id)).toEqual(["2", "1"]);
    expect(api.search({ sessionId: "s-2" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("defaults to 50 results and caps at 200", () => {
    const many = Array.from({ length: 300 }, (_, i) => e(String(i + 1), `cmd ${i}`));
    const api = createHistoryAPI(makePorts(many));
    expect(api.search({})).toHaveLength(50);
    expect(api.search({ limit: 1000 })).toHaveLength(200);
  });
});
