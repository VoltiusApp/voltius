// Fills the App Store listing from listing.json: app info (subtitle, privacy URL,
// categories), the version texts in each language, content rights and a free
// price. Idempotent; never submits anything for review.
import { readFileSync } from "node:fs";
import { app, asc, get } from "./client.mjs";

const listing = JSON.parse(readFileSync(new URL("./listing.json", import.meta.url), "utf8"));
const a = await app();
const step = async (label, fn) => {
  try {
    await fn();
    console.log(`ok    ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}: ${e.message}`);
    process.exitCode = 1;
  }
};

await step("content rights", () =>
  asc("PATCH", `/v1/apps/${a.id}`, {
    data: { type: "apps", id: a.id, attributes: { contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } },
  }),
);

// App info: categories and per-language name / subtitle / privacy policy.
const info = (await get(`/v1/apps/${a.id}/appInfos`)).data.find((i) => i.attributes.appStoreState !== "READY_FOR_SALE")
  ?? (await get(`/v1/apps/${a.id}/appInfos`)).data[0];
await step("categories", () =>
  asc("PATCH", `/v1/appInfos/${info.id}`, {
    data: {
      type: "appInfos",
      id: info.id,
      relationships: {
        primaryCategory: { data: { type: "appCategories", id: listing.primaryCategory } },
        secondaryCategory: { data: { type: "appCategories", id: listing.secondaryCategory } },
      },
    },
  }),
);
const infoLocs = (await get(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
for (const [locale, l] of Object.entries(listing.locales)) {
  const attributes = { name: listing.name, subtitle: l.subtitle, privacyPolicyUrl: listing.privacyPolicyUrl };
  const existing = infoLocs.find((x) => x.attributes.locale === locale);
  await step(`app info ${locale}`, () =>
    existing
      ? asc("PATCH", `/v1/appInfoLocalizations/${existing.id}`, { data: { type: "appInfoLocalizations", id: existing.id, attributes } })
      : asc("POST", "/v1/appInfoLocalizations", {
          data: {
            type: "appInfoLocalizations",
            attributes: { locale, ...attributes },
            relationships: { appInfo: { data: { type: "appInfos", id: info.id } } },
          },
        }),
  );
}

// The version being prepared: copyright and per-language texts.
const version = (await get(`/v1/apps/${a.id}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED`)).data[0];
if (!version) throw new Error("no editable App Store version");
await step(`version ${version.attributes.versionString} copyright`, () =>
  asc("PATCH", `/v1/appStoreVersions/${version.id}`, {
    data: { type: "appStoreVersions", id: version.id, attributes: { copyright: listing.copyright } },
  }),
);
const versionLocs = (await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
for (const [locale, l] of Object.entries(listing.locales)) {
  const attributes = {
    description: l.description,
    keywords: l.keywords,
    promotionalText: l.promotionalText,
    supportUrl: listing.supportUrl,
    marketingUrl: listing.marketingUrl,
  };
  if (l.keywords.length > 100) throw new Error(`${locale} keywords are ${l.keywords.length} chars`);
  if (l.subtitle.length > 30) throw new Error(`${locale} subtitle is ${l.subtitle.length} chars`);
  if (l.promotionalText.length > 170) throw new Error(`${locale} promotional text is ${l.promotionalText.length} chars`);
  const existing = versionLocs.find((x) => x.attributes.locale === locale);
  await step(`version texts ${locale}`, () =>
    existing
      ? asc("PATCH", `/v1/appStoreVersionLocalizations/${existing.id}`, {
          data: { type: "appStoreVersionLocalizations", id: existing.id, attributes },
        })
      : asc("POST", "/v1/appStoreVersionLocalizations", {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale, ...attributes },
            relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
          },
        }),
  );
}

// Free, in every territory (base territory USA).
await step("price: free", async () => {
  const points = await get(`/v1/apps/${a.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const free = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error("no free price point");
  await asc("POST", "/v1/appPriceSchedules", {
    data: {
      type: "appPriceSchedules",
      relationships: {
        app: { data: { type: "apps", id: a.id } },
        baseTerritory: { data: { type: "territories", id: "USA" } },
        manualPrices: { data: [{ type: "appPrices", id: "${price}" }] },
      },
    },
    included: [
      {
        type: "appPrices",
        id: "${price}",
        attributes: { startDate: null },
        relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } },
      },
    ],
  });
});
