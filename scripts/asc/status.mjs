// Prints the state of the App Store record: app, builds, versions, app info.
import { app, get } from "./client.mjs";

const a = await app();
console.log(`app ${a.id} ${a.attributes.name} ${a.attributes.bundleId} primaryLocale=${a.attributes.primaryLocale}`);

const builds = await get(`/v1/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=10&include=buildBetaDetail`);
console.log(`\nbuilds (${builds.data.length}):`);
for (const b of builds.data) {
  const at = b.attributes;
  console.log(`  ${b.id} v${at.version} uploaded=${at.uploadedDate} state=${at.processingState} expired=${at.expired} encryption=${at.usesNonExemptEncryption}`);
}

const versions = await get(`/v1/apps/${a.id}/appStoreVersions?limit=5`);
console.log(`\nversions (${versions.data.length}):`);
for (const v of versions.data) {
  console.log(`  ${v.id} ${v.attributes.platform} ${v.attributes.versionString} ${v.attributes.appStoreState}`);
  const locs = await get(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  for (const l of locs.data) console.log(`    loc ${l.id} ${l.attributes.locale} desc=${(l.attributes.description ?? "").length} chars`);
}

const infos = await get(`/v1/apps/${a.id}/appInfos`);
for (const i of infos.data) {
  console.log(`\nappInfo ${i.id} state=${i.attributes.appStoreState ?? i.attributes.state} age=${i.attributes.appStoreAgeRating}`);
  const locs = await get(`/v1/appInfos/${i.id}/appInfoLocalizations`);
  for (const l of locs.data) console.log(`  loc ${l.id} ${l.attributes.locale} name=${l.attributes.name} subtitle=${l.attributes.subtitle} privacy=${l.attributes.privacyPolicyUrl}`);
}

const groups = await get(`/v1/apps/${a.id}/betaGroups`);
console.log(`\nbeta groups: ${groups.data.map((g) => `${g.attributes.name}(internal=${g.attributes.isInternalGroup})`).join(", ") || "none"}`);
