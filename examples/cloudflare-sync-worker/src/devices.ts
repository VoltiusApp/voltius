import {
  ManifestConflictError,
  etagsMatch,
  readManifestRecord,
  writeManifest,
  type Manifest,
  type ManifestDevice,
} from "./manifest";

export function deviceObjectKey(deviceId: string): string {
  return `devices/${deviceId}.b64`;
}

export function isValidDeviceId(deviceId: string): boolean {
  // UUIDs and similar opaque ids — reject path traversal / empty
  if (!deviceId || deviceId.length > 128) return false;
  if (deviceId.includes("/") || deviceId.includes("..") || deviceId.includes("\\")) return false;
  return /^[A-Za-z0-9._-]+$/.test(deviceId);
}

export type DevicePutBody = {
  content: string;
  label: string;
  pushedAt: string;
};

export function parseDevicePutBody(value: unknown): DevicePutBody | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.content !== "string" || v.content.length === 0) return null;
  if (typeof v.label !== "string") return null;
  if (typeof v.pushedAt !== "string" || v.pushedAt.length === 0) return null;
  return { content: v.content, label: v.label, pushedAt: v.pushedAt };
}

export async function getDeviceBlob(
  bucket: R2Bucket,
  deviceId: string,
): Promise<{ content: string; etag: string } | null> {
  const obj = await bucket.get(deviceObjectKey(deviceId));
  if (!obj) return null;
  const content = await obj.text();
  return { content, etag: obj.httpEtag || obj.etag };
}

export async function putDeviceBlob(
  bucket: R2Bucket,
  deviceId: string,
  body: DevicePutBody,
  opts: { ifMatch?: string | null } = {},
): Promise<{ etag: string; manifest: Manifest }> {
  const current = await readManifestRecord(bucket);
  if (!current) {
    throw new Error("manifest.json missing — create it before uploading devices");
  }
  // If-Match on device PUT is the *manifest* ETag (RMW target).
  if (opts.ifMatch && !etagsMatch(opts.ifMatch, current.etag)) {
    throw new ManifestConflictError("If-Match does not match current manifest ETag");
  }

  const key = deviceObjectKey(deviceId);
  const put = await bucket.put(key, body.content, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  const entry: ManifestDevice = { id: deviceId, label: body.label, pushedAt: body.pushedAt };
  const idx = current.manifest.devices.findIndex((d) => d.id === deviceId);
  const devices =
    idx >= 0
      ? current.manifest.devices.map((d, i) => (i === idx ? entry : d))
      : [...current.manifest.devices, entry];
  const next = { ...current.manifest, devices };
  const written = await writeManifest(bucket, next, { ifMatch: current.etag });
  void written;

  return { etag: put.httpEtag || put.etag, manifest: next };
}

export async function deleteDeviceBlob(
  bucket: R2Bucket,
  deviceId: string,
): Promise<Manifest | null> {
  await bucket.delete(deviceObjectKey(deviceId));
  const rec = await readManifestRecord(bucket);
  if (!rec) return null;
  const devices = rec.manifest.devices.filter((d) => d.id !== deviceId);
  const next = { ...rec.manifest, devices };
  await writeManifest(bucket, next, { ifMatch: rec.etag });
  return next;
}
