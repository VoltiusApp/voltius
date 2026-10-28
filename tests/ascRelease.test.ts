import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { release } from "../scripts/asc/release.mjs";

type Version = { id: string; attributes: { appStoreState: string; versionString: string } };

function fakeAsc({ buildStates = ["VALID"], encryption = false as boolean | null, versions = [] as Version[], openSubmission = false, itemConflict = false } = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let polls = 0;
  const api = {
    async get(path: string) {
      if (path.startsWith("/v1/builds")) {
        const state = buildStates[Math.min(polls++, buildStates.length - 1)];
        return { data: state ? [{ id: "b1", attributes: { processingState: state, usesNonExemptEncryption: encryption } }] : [] };
      }
      if (path.includes("/appStoreVersions?")) return { data: versions };
      if (path.endsWith("/appStoreVersionLocalizations")) return { data: [{ id: "en" }, { id: "fr" }] };
      if (path.startsWith("/v1/reviewSubmissions")) return { data: openSubmission ? [{ id: "rs-open" }] : [] };
      throw new Error(`unexpected GET ${path}`);
    },
    async asc(method: string, path: string, body: any) {
      writes.push({ method, path, body });
      if (path === "/v1/appStoreVersions") return { data: { id: "v-new", attributes: {} } };
      if (path === "/v1/reviewSubmissions") return { data: { id: "rs-new" } };
      if (path === "/v1/reviewSubmissionItems" && itemConflict) throw Object.assign(new Error("dup"), { status: 409 });
      return { data: {} };
    },
  };
  return { api, writes };
}

const run = (api: unknown, extra = {}) =>
  release(api, { appId: "app1", version: "0.64.0", build: "31", notes: "• New", sleep: async () => {}, log: () => {}, ...extra });

const released: Version = { id: "v-old", attributes: { appStoreState: "READY_FOR_SALE", versionString: "0.63.1" } };

describe("release", () => {
  it("creates the version, sets What's New, attaches the build and submits", async () => {
    const { api, writes } = fakeAsc({ versions: [released] });
    await run(api);
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      "POST /v1/appStoreVersions",
      "PATCH /v1/appStoreVersionLocalizations/en",
      "PATCH /v1/appStoreVersionLocalizations/fr",
      "PATCH /v1/appStoreVersions/v-new/relationships/build",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/rs-new",
    ]);
    expect(writes[0].body.data.attributes).toEqual({ platform: "IOS", versionString: "0.64.0", releaseType: "AFTER_APPROVAL" });
    expect(writes[1].body.data.attributes).toEqual({ whatsNew: "• New" });
    expect(writes[3].body).toEqual({ data: { type: "builds", id: "b1" } });
    expect(writes[6].body.data.attributes).toEqual({ submitted: true });
  });

  it("reuses an editable version and an open submission, and skips What's New before the first release", async () => {
    const editable: Version = { id: "v-edit", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION", versionString: "0.63.1" } };
    const { api, writes } = fakeAsc({ versions: [editable], openSubmission: true, itemConflict: true });
    await run(api);
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      "PATCH /v1/appStoreVersions/v-edit",
      "PATCH /v1/appStoreVersions/v-edit/relationships/build",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/rs-open",
    ]);
    expect(writes[0].body.data.attributes).toEqual({ versionString: "0.64.0", releaseType: "AFTER_APPROVAL" });
  });

  it("waits while Apple processes the build", async () => {
    const { api, writes } = fakeAsc({ buildStates: ["", "PROCESSING", "VALID"], versions: [released] });
    await run(api);
    expect(writes.at(-1)?.body.data.attributes).toEqual({ submitted: true });
  });

  it("stops before touching the version when the build has no export compliance answer", async () => {
    const { api, writes } = fakeAsc({ encryption: null });
    await expect(run(api)).rejects.toThrow(/ITSAppUsesNonExemptEncryption/);
    expect(writes).toEqual([]);
  });

  it("fails on an invalid build and on a timeout", async () => {
    await expect(run(fakeAsc({ buildStates: ["INVALID"] }).api)).rejects.toThrow(/INVALID/);
    await expect(run(fakeAsc({ buildStates: ["PROCESSING"] }).api, { timeoutMs: -1 })).rejects.toThrow(/still PROCESSING/);
  });
});
