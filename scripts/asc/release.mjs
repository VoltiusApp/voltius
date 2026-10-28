// Submits an uploaded build for App Store review: waits for Apple to process it,
// creates or reuses the editable App Store version, sets "What's New", attaches
// the build and submits it. The version is released automatically on approval.
//   node scripts/asc/release.mjs --version 0.64.0 --build 31 [--notes notes.txt]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EDITABLE = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];

/** `api` is { asc(method, path, body), get(path) } from client.mjs; `sleep` is injectable for tests. */
export async function release(api, { appId, version, build, notes, pollMs = 60_000, timeoutMs = 90 * 60_000, sleep, log = console.log }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let b;
  for (const started = Date.now(); ; await wait(pollMs)) {
    b = (await api.get(`/v1/builds?filter[app]=${appId}&filter[version]=${build}&filter[preReleaseVersion.version]=${version}&limit=1`)).data[0];
    const state = b?.attributes.processingState;
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID") throw new Error(`build ${version} (${build}) is ${state}`);
    if (Date.now() - started > timeoutMs) throw new Error(`build ${version} (${build}) still ${state ?? "missing"} after ${timeoutMs / 60_000} min`);
    log(`waiting for build ${version} (${build}): ${state ?? "not uploaded yet"}`);
  }
  if (b.attributes.usesNonExemptEncryption == null) {
    throw new Error(`build ${version} (${build}) has no export compliance answer; add ITSAppUsesNonExemptEncryption to src-tauri/Info.ios.plist`);
  }

  const versions = (await api.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=50`)).data;
  const released = versions.some((v) => v.attributes.appStoreState === "READY_FOR_SALE");
  let v = versions.find((x) => EDITABLE.includes(x.attributes.appStoreState));
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

  // Apple rejects "What's New" on an app's first version.
  if (notes && released) {
    for (const loc of (await api.get(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data) {
      await api.asc("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, {
        data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: notes } },
      });
    }
  }

  await api.asc("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });

  const open = (await api.get(`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`)).data[0];
  const submission = open ?? (await api.asc("POST", "/v1/reviewSubmissions", {
    data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: appId } } } },
  })).data;
  try {
    await api.asc("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
          appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
        },
      },
    });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
  await api.asc("PATCH", `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
  });
  log(`submitted ${version} (${build}) for review; it is released automatically once approved`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values: o } = parseArgs({ options: { version: { type: "string" }, build: { type: "string" }, notes: { type: "string" } } });
  const client = await import("./client.mjs");
  await release(client, {
    appId: (await client.app()).id,
    version: o.version,
    build: o.build,
    notes: o.notes ? readFileSync(o.notes, "utf8").trim() : "",
  });
}
