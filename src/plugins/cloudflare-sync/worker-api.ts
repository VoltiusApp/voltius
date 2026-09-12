import type { PluginAPI } from "@/plugins/api";

type Http = PluginAPI["http"];

export type WorkerDevice = {
  id: string;
  label: string;
  pushedAt: string;
};

export type WorkerManifest = {
  schema: 1;
  salt: string;
  devices: WorkerDevice[];
};

export type ManifestGetResult = {
  manifest: WorkerManifest;
  etag: string | null;
};

export class WorkerApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

export function isConflictStatus(status: number): boolean {
  return status === 412 || status === 409;
}

function normalizeBaseUrl(workerUrl: string): string {
  return workerUrl.replace(/\/+$/, "");
}

function headers(token: string, ifMatch?: string | null): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (ifMatch) h["If-Match"] = ifMatch;
  return h;
}

async function checkResponse(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new WorkerApiError(res.status, `${context}: ${message}`);
  }
}

export async function getHealth(http: Http, workerUrl: string): Promise<{ ok: boolean; version: number }> {
  const res = await http.stream(`${normalizeBaseUrl(workerUrl)}/health`);
  await checkResponse(res, "getHealth");
  return res.json();
}

export async function getManifestWithEtag(
  http: Http,
  workerUrl: string,
  token: string,
): Promise<ManifestGetResult> {
  const res = await http.stream(`${normalizeBaseUrl(workerUrl)}/v1/manifest`, {
    headers: headers(token),
  });
  await checkResponse(res, "getManifest");
  const manifest = (await res.json()) as WorkerManifest;
  return { manifest, etag: res.headers.get("ETag") };
}

export async function getManifest(
  http: Http,
  workerUrl: string,
  token: string,
): Promise<WorkerManifest> {
  return (await getManifestWithEtag(http, workerUrl, token)).manifest;
}

export async function putManifest(
  http: Http,
  workerUrl: string,
  token: string,
  manifest: WorkerManifest,
  opts: { ifMatch?: string | null } = {},
): Promise<WorkerManifest> {
  const res = await http.stream(`${normalizeBaseUrl(workerUrl)}/v1/manifest`, {
    method: "PUT",
    headers: headers(token, opts.ifMatch),
    body: JSON.stringify(manifest),
  });
  await checkResponse(res, "putManifest");
  return res.json();
}

export async function getDeviceBlob(
  http: Http,
  workerUrl: string,
  token: string,
  deviceId: string,
): Promise<string> {
  const res = await http.stream(
    `${normalizeBaseUrl(workerUrl)}/v1/devices/${encodeURIComponent(deviceId)}`,
    { headers: headers(token) },
  );
  await checkResponse(res, `getDeviceBlob(${deviceId})`);
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function getDeviceBlobs(
  http: Http,
  workerUrl: string,
  token: string,
  deviceIds: string[],
): Promise<string[]> {
  const blobs: string[] = [];
  for (const id of deviceIds) {
    try {
      blobs.push(await getDeviceBlob(http, workerUrl, token, id));
    } catch (err) {
      if (err instanceof WorkerApiError && err.status === 404) continue;
      throw err;
    }
  }
  return blobs;
}

export async function putDeviceBlob(
  http: Http,
  workerUrl: string,
  token: string,
  deviceId: string,
  body: { content: string; label: string; pushedAt: string },
  opts: { ifMatch?: string | null } = {},
): Promise<void> {
  const res = await http.stream(
    `${normalizeBaseUrl(workerUrl)}/v1/devices/${encodeURIComponent(deviceId)}`,
    {
      method: "PUT",
      headers: headers(token, opts.ifMatch),
      body: JSON.stringify(body),
    },
  );
  await checkResponse(res, `putDeviceBlob(${deviceId})`);
}

export async function deleteDevice(
  http: Http,
  workerUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  const res = await http.stream(
    `${normalizeBaseUrl(workerUrl)}/v1/devices/${encodeURIComponent(deviceId)}`,
    {
      method: "DELETE",
      headers: headers(token),
    },
  );
  await checkResponse(res, `deleteDevice(${deviceId})`);
}
