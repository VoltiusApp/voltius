import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { release } from "../scripts/asc/release.mjs";

type Version = { id: string; attributes: { appStoreState: string; versionString: string } };

const CHANGELOG = `## [0.64.0] - 2026-11-14

- New

## [0.63.2] - 2026-11-13

- Fixed

## [0.63.1] - 2026-11-12

- Old
`;

function fakeAsc({
  buildStates = ["VALID"],
  encryption = false as boolean | null,
  versions = [] as Version[],
  openSubmission = false,
  openItems = [] as string[],
  itemError = false,
} = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let polls = 0;
  const api = {
    async get(path: string) {
      if (path.includes("include=preReleaseVersion")) {
        return { data: [{ id: "b9", attributes: { version: "40" } }], included: [{ type: "preReleaseVersions", attributes: { version: "0.64.0" } }] };
      }
      if (path.startsWith("/v1/builds")) {
        const state = buildStates[Math.min(polls++, buildStates.length - 1)];
        return { data: state ? [{ id: "b1", attributes: { processingState: state, usesNonExemptEncryption: encryption } }] : [] };
      }
      if (path.includes("/appStoreVersions?")) return { data: versions };
      if (path.endsWith("/appStoreVersionLocalizations")) return { data: [{ id: "en" }, { id: "fr" }] };
      if (path.includes("/items?")) return { data: openItems.map((id) => ({ relationships: { appStoreVersion: { data: { id } } } })) };
      if (path.startsWith("/v1/reviewSubmissions")) return { data: openSubmission ? [{ id: "rs-open" }] : [] };
      throw new Error(`unexpected GET ${path}`);
    },
    async asc(method: string, path: string, body: any) {
      writes.push({ method, path, body });
      if (path === "/v1/appStoreVersions") return { data: { id: "v-new", attributes: {} } };
      if (path === "/v1/reviewSubmissions") return { data: { id: "rs-new" } };
      if (path === "/v1/reviewSubmissionItems" && itemError) throw Object.assign(new Error("whatsNew missing"), { status: 409 });
      return { data: {} };
    },
  };
  return { api, writes };
}

const run = (api: unknown, extra = {}) =>
  release(api, { appId: "app1", version: "0.64.0", build: "31", changelog: CHANGELOG, sleep: async () => {}, log: () => {}, ...extra });

const version = (id: string, versionString: string, appStoreState: string): Version => ({ id, attributes: { appStoreState, versionString } });
const released = version("v-old", "0.63.1", "READY_FOR_SALE");
const calls = (writes: Array<{ method: string; path: string }>) => writes.map((w) => `${w.method} ${w.path}`);

describe("release", () => {
  it("creates the version, sets What's New, attaches the build and submits", async () => {
    const { api, writes } = fakeAsc({ versions: [released] });
    expect(await run(api)).toBe("submitted");
    expect(calls(writes)).toEqual([
      "POST /v1/appStoreVersions",
      "PATCH /v1/appStoreVersionLocalizations/en",
      "PATCH /v1/appStoreVersionLocalizations/fr",
      "PATCH /v1/appStoreVersions/v-new/relationships/build",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/rs-new",
    ]);
    expect(writes[0].body.data.attributes).toEqual({ platform: "IOS", versionString: "0.64.0", releaseType: "AFTER_APPROVAL" });
    expect(writes[1].body.data.attributes).toEqual({ whatsNew: "• New\n• Fixed" });
    expect(writes[3].body).toEqual({ data: { type: "builds", id: "b1" } });
    expect(writes[6].body.data.attributes).toEqual({ submitted: true });
  });

  it("reuses an editable version and an open submission, and skips What's New before the first release", async () => {
    const editable = version("v-edit", "0.63.1", "PREPARE_FOR_SUBMISSION");
    const { api, writes } = fakeAsc({ versions: [editable], openSubmission: true });
    await run(api);
    expect(calls(writes)).toEqual([
      "PATCH /v1/appStoreVersions/v-edit",
      "PATCH /v1/appStoreVersions/v-edit/relationships/build",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/rs-open",
    ]);
    expect(writes[0].body.data.attributes).toEqual({ versionString: "0.64.0", releaseType: "AFTER_APPROVAL" });
  });

  it("does not add the version twice to an open submission", async () => {
    const editable = version("v-edit", "0.64.0", "PREPARE_FOR_SUBMISSION");
    const { api, writes } = fakeAsc({ versions: [released, editable], openSubmission: true, openItems: ["v-edit"] });
    await run(api);
    expect(calls(writes)).not.toContain("POST /v1/reviewSubmissionItems");
    expect(writes.at(-1)?.body.data.attributes).toEqual({ submitted: true });
  });

  it("surfaces Apple's reason when the version cannot join the submission", async () => {
    const { api, writes } = fakeAsc({ versions: [released], itemError: true });
    await expect(run(api)).rejects.toThrow(/whatsNew missing/);
    expect(calls(writes)).not.toContain("PATCH /v1/reviewSubmissions/rs-new");
  });

  it.each(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE"])("defers without writing while another version is %s", async (state) => {
    const { api, writes } = fakeAsc({ versions: [released, version("v-busy", "0.63.2", state)] });
    expect(await run(api)).toBe("deferred");
    expect(writes).toEqual([]);
  });

  it("does nothing when the version is already submitted or live", async () => {
    const { api, writes } = fakeAsc({ versions: [version("v-done", "0.64.0", "READY_FOR_SALE")] });
    expect(await run(api)).toBe("done");
    expect(writes).toEqual([]);
  });

  it("submits the newest uploaded build when no version is given", async () => {
    const { api, writes } = fakeAsc({ versions: [released] });
    expect(await run(api, { version: undefined, build: undefined })).toBe("submitted");
    expect(writes[0].body.data.attributes.versionString).toBe("0.64.0");
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

  it("fails on an invalid build, a timeout and a missing changelog section", async () => {
    await expect(run(fakeAsc({ buildStates: ["INVALID"] }).api)).rejects.toThrow(/INVALID/);
    await expect(run(fakeAsc({ buildStates: ["PROCESSING"] }).api, { timeoutMs: -1 })).rejects.toThrow(/still PROCESSING/);
    await expect(run(fakeAsc({ versions: [released] }).api, { changelog: "" })).rejects.toThrow(/CHANGELOG/);
  });
});
