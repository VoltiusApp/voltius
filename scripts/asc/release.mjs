// Submits an uploaded build for App Store review: waits for Apple to process it,
// creates or reuses the editable App Store version, sets "What's New", attaches
// the build and submits it. The version is released automatically on approval.
// Without --version it submits the newest uploaded build (the scheduled run).
//   node scripts/asc/release.mjs [--version 0.64.0 --build 31]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { changelogSince, storeNotes } from "../store/release-notes.mjs";

const EDITABLE = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];
const IN_FLIGHT = ["READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_APPLE_RELEASE", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_APP_STORE"];
const NOTES_LIMIT = 4000;

const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** The newest uploaded build, as { version, build }. */
export async function latestBuild(api, appId) {
  const r = await api.get(`/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1&include=preReleaseVersion`);
  const pre = r.included?.find((i) => i.type === "preReleaseVersions");
  if (!r.data[0] || !pre) throw new Error("no uploaded build");
  return { version: pre.attributes.version, build: r.data[0].attributes.version };
}

/**
 * `api` is { asc(method, path, body), get(path) } from client.mjs; `sleep` is injectable for tests.
 * Returns "submitted", "deferred" (Apple allows one version in review at a time) or "done".
 */
export async function release(api, { appId, version, build, changelog = "", pollMs = 60_000, timeoutMs = 90 * 60_000, sleep, log = console.log }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!version) ({ version, build } = await latestBuild(api, appId));

  const versions = (await api.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=50`)).data;
  const state = (x) => x.attributes.appStoreState;
  const same = versions.find((x) => x.attributes.versionString === version && !EDITABLE.includes(state(x)));
  if (same) {
    log(`${version} is already ${state(same)}`);
    return "done";
  }
  const busy = versions.find((x) => IN_FLIGHT.includes(state(x)));
  if (busy) {
    log(`${busy.attributes.versionString} is ${state(busy)}; the scheduled asc run submits ${version} once it clears`);
    return "deferred";
  }
  const live = versions.filter((x) => state(x) === "READY_FOR_SALE").map((x) => x.attributes.versionString).sort(byVersion).at(-1);
  // Apple rejects "What's New" on an app's first version and requires it on every later one.
  const section = live ? changelogSince(changelog, version, live) : "";
  if (section == null) throw new Error(`no CHANGELOG.md section for ${version}`);

  let b;
  for (const started = Date.now(); ; await wait(pollMs)) {
    b = (await api.get(`/v1/builds?filter[app]=${appId}&filter[version]=${build}&filter[preReleaseVersion.version]=${version}&limit=1`)).data[0];
    const s = b?.attributes.processingState;
    if (s === "VALID") break;
    if (s === "FAILED" || s === "INVALID") throw new Error(`build ${version} (${build}) is ${s}`);
    if (Date.now() - started > timeoutMs) throw new Error(`build ${version} (${build}) still ${s ?? "missing"} after ${timeoutMs / 60_000} min`);
    log(`waiting for build ${version} (${build}): ${s ?? "not uploaded yet"}`);
  }
  if (b.attributes.usesNonExemptEncryption == null) {
    throw new Error(`build ${version} (${build}) has no export compliance answer; add ITSAppUsesNonExemptEncryption to src-tauri/Info.ios.plist`);
  }

  let v = versions.find((x) => EDITABLE.includes(state(x)));
  if (v) {
    await api.asc("PATCH", `/v1/appStoreVersions/${v.id}`, {
      data: { type: "appStoreVersions", id: v.id, attributes: { versionString: version, releaseType: "AFTER_APPROVAL" } },
    });
  } else {
    v = (await api.asc("POST", "/v1/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: version, releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    })).data;
  }
  log(`version ${version}: ${v.id}`);

  if (section) {
    const whatsNew = storeNotes(section, NOTES_LIMIT);
    for (const loc of (await api.get(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data) {
      await api.asc("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, {
        data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew } },
      });
    }
  }

  await api.asc("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });

  const open = (await api.get(`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`)).data[0];
  const submission = open ?? (await api.asc("POST", "/v1/reviewSubmissions", {
    data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: appId } } } },
  })).data;
  const items = open ? (await api.get(`/v1/reviewSubmissions/${submission.id}/items?include=appStoreVersion`)).data : [];
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === v.id)) {
    await api.asc("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
          appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
        },
      },
    });
  }
  await api.asc("PATCH", `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
  });
  log(`submitted ${version} (${build}) for review; it is released automatically once approved`);
  return "submitted";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values: o } = parseArgs({ options: { version: { type: "string" }, build: { type: "string" } } });
  if (!o.version !== !o.build) throw new Error("--version and --build go together");
  const client = await import("./client.mjs");
  await release(client, {
    appId: (await client.app()).id,
    version: o.version,
    build: o.build,
    changelog: readFileSync("CHANGELOG.md", "utf8"),
  });
}
