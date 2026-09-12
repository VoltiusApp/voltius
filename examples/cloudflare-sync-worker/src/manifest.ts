export const MANIFEST_KEY = "manifest.json";

export type ManifestDevice = {
  id: string;
  label: string;
  pushedAt: string;
};

export type Manifest = {
  schema: 1;
  salt: string;
  devices: ManifestDevice[];
};

export type ManifestRecord = {
  manifest: Manifest;
  etag: string;
};

export class ManifestConflictError extends Error {
  constructor(message = "manifest etag mismatch") {
    super(message);
    this.name = "ManifestConflictError";
  }
}

const SALT_RE = /^[0-9a-f]{32}$/i;

export function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== 1) return false;
  if (typeof v.salt !== "string" || !SALT_RE.test(v.salt)) return false;
  if (!Array.isArray(v.devices)) return false;
  for (const d of v.devices) {
    if (!d || typeof d !== "object") return false;
    const device = d as Record<string, unknown>;
    if (typeof device.id !== "string" || device.id.length === 0) return false;
    if (typeof device.label !== "string") return false;
    if (typeof device.pushedAt !== "string" || device.pushedAt.length === 0) return false;
  }
  return true;
}

export function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export function etagsMatch(a: string, b: string): boolean {
  return normalizeEtag(a) === normalizeEtag(b);
}

function objectEtag(obj: R2Object | R2ObjectBody): string {
  return obj.httpEtag || obj.etag;
}

export async function readManifestRecord(bucket: R2Bucket): Promise<ManifestRecord | null> {
  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) return null;
  const text = await obj.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!isManifest(parsed)) {
    throw new Error("manifest.json failed schema validation");
  }
  return { manifest: parsed, etag: objectEtag(obj) };
}

export async function readManifest(bucket: R2Bucket): Promise<Manifest | null> {
  const rec = await readManifestRecord(bucket);
  return rec?.manifest ?? null;
}

export async function writeManifest(
  bucket: R2Bucket,
  manifest: Manifest,
  opts: { ifMatch?: string } = {},
): Promise<{ etag: string }> {
  if (!isManifest(manifest)) {
    throw new Error("refusing to write invalid manifest");
  }
  const putOpts: R2PutOptions = {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  };
  if (opts.ifMatch) {
    // R2 onlyIf.etagMatches must be unquoted; HTTP ETags are quoted.
    putOpts.onlyIf = { etagMatches: normalizeEtag(opts.ifMatch) };
  }
  const put = await bucket.put(MANIFEST_KEY, JSON.stringify(manifest, null, 2), putOpts);
  if (!put) {
    throw new ManifestConflictError();
  }
  return { etag: objectEtag(put) };
}
