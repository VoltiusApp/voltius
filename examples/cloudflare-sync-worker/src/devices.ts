import { readManifest, writeManifest, type Manifest, type ManifestDevice } from "./manifest";

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
): Promise<{ etag: string; manifest: Manifest }> {
  const key = deviceObjectKey(deviceId);
  const put = await bucket.put(key, body.content, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  let manifest = await readManifest(bucket);
  if (!manifest) {
    throw new Error("manifest.json missing — create it before uploading devices");
  }

  const entry: ManifestDevice = { id: deviceId, label: body.label, pushedAt: body.pushedAt };
  const idx = manifest.devices.findIndex((d) => d.id === deviceId);
  const devices =
    idx >= 0
      ? manifest.devices.map((d, i) => (i === idx ? entry : d))
      : [...manifest.devices, entry];
  manifest = { ...manifest, devices };
  await writeManifest(bucket, manifest);

  return { etag: put.httpEtag || put.etag, manifest };
}

export async function deleteDeviceBlob(
  bucket: R2Bucket,
  deviceId: string,
): Promise<Manifest | null> {
  await bucket.delete(deviceObjectKey(deviceId));
  const manifest = await readManifest(bucket);
  if (!manifest) return null;
  const devices = manifest.devices.filter((d) => d.id !== deviceId);
  const next = { ...manifest, devices };
  await writeManifest(bucket, next);
  return next;
}
