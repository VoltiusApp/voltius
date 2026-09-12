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

export async function readManifest(bucket: R2Bucket): Promise<Manifest | null> {
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
  return parsed;
}

export async function writeManifest(bucket: R2Bucket, manifest: Manifest): Promise<void> {
  if (!isManifest(manifest)) {
    throw new Error("refusing to write invalid manifest");
  }
  await bucket.put(MANIFEST_KEY, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}
