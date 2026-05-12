import { appFetch } from "@/services/http";

// GitHub Gist REST API wrapper. Uses Tauri HTTP to avoid WebView networking quirks.

const BASE = "https://api.github.com";

export interface GistDevice {
  id: string;
  label: string;
  pushedAt: string; // ISO timestamp
}

export interface GistManifest {
  schema: 1;
  salt: string; // hex, 16 bytes
  devices: GistDevice[];
}

interface GistFile {
  filename: string;
  content: string;
}

interface GistResponse {
  id: string;
  html_url: string;
  files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
}

function headers(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function checkResponse(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new GistApiError(res.status, `${context}: ${text}`);
  }
}

export class GistApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GistApiError";
  }
}

export async function createGist(
  pat: string,
  manifest: GistManifest,
): Promise<{ id: string; url: string }> {
  const res = await appFetch(`${BASE}/gists`, {
    method: "POST",
    headers: headers(pat),
    body: JSON.stringify({
      description: "Voltius Sync — do not edit manually",
      public: false,
      files: {
        "manifest.json": { content: JSON.stringify(manifest, null, 2) },
      },
    }),
  });
  await checkResponse(res, "createGist");
  const data: GistResponse = await res.json();
  return { id: data.id, url: data.html_url };
}

export async function getManifest(pat: string, gistId: string): Promise<GistManifest> {
  const content = await getFile(pat, gistId, "manifest.json");
  try {
    return JSON.parse(content) as GistManifest;
  } catch {
    throw new Error("gist-sync: manifest.json is not valid JSON");
  }
}

export async function getFile(pat: string, gistId: string, filename: string): Promise<string> {
  const res = await appFetch(`${BASE}/gists/${gistId}`, {
    headers: headers(pat),
  });
  await checkResponse(res, `getFile(${filename})`);
  const data: GistResponse = await res.json();
  const file = data.files[filename];
  if (!file) throw new Error(`gist-sync: file "${filename}" not found in gist`);

  // GitHub truncates files >1MB — fetch raw URL if needed
  if (file.truncated && file.raw_url) {
    const rawRes = await appFetch(file.raw_url, { headers: headers(pat) });
    await checkResponse(rawRes, `getFile raw(${filename})`);
    return rawRes.text();
  }

  return file.content ?? "";
}

export async function getDeviceBlobs(
  pat: string,
  gistId: string,
  deviceIds: string[],
): Promise<string[]> {
  // Fetch gist once, extract all requested device files
  const res = await appFetch(`${BASE}/gists/${gistId}`, {
    headers: headers(pat),
  });
  await checkResponse(res, "getDeviceBlobs");
  const data: GistResponse = await res.json();

  const blobs: string[] = [];
  for (const deviceId of deviceIds) {
    const filename = `device-${deviceId}.b64`;
    const file = data.files[filename];
    if (!file) continue; // device file missing — skip

    let content = file.content ?? "";
    if (file.truncated && file.raw_url) {
      const rawRes = await appFetch(file.raw_url, { headers: headers(pat) });
      if (rawRes.ok) content = await rawRes.text();
    }
    if (content) blobs.push(content);
  }
  return blobs;
}

export async function patchFiles(
  pat: string,
  gistId: string,
  files: Record<string, GistFile | null>,
): Promise<void> {
  // Build GitHub patch payload: null value = delete file
  const filesPayload: Record<string, { content: string } | null> = {};
  for (const [key, val] of Object.entries(files)) {
    filesPayload[key] = val ? { content: val.content } : null;
  }
  const res = await appFetch(`${BASE}/gists/${gistId}`, {
    method: "PATCH",
    headers: headers(pat),
    body: JSON.stringify({ files: filesPayload }),
  });
  await checkResponse(res, "patchFiles");
}

export async function deleteDeviceFile(
  pat: string,
  gistId: string,
  deviceId: string,
): Promise<void> {
  const filename = `device-${deviceId}.b64`;
  await patchFiles(pat, gistId, { [filename]: null });
}

export async function listVoltiusGists(pat: string): Promise<{ id: string; url: string }[]> {
  const results: { id: string; url: string }[] = [];
  let page = 1;
  while (true) {
    const res = await appFetch(`${BASE}/gists?per_page=100&page=${page}`, { headers: headers(pat) });
    await checkResponse(res, "listVoltiusGists");
    const data: { id: string; html_url: string; description: string }[] = await res.json();
    if (data.length === 0) break;
    for (const g of data) {
      if (g.description === "Voltius Sync — do not edit manually")
        results.push({ id: g.id, url: g.html_url });
    }
    if (data.length < 100) break;
    page++;
  }
  return results;
}

export async function deleteGistById(pat: string, gistId: string): Promise<void> {
  const res = await appFetch(`${BASE}/gists/${gistId}`, {
    method: "DELETE",
    headers: headers(pat),
  });
  // 204 No Content on success; anything else is an error
  if (res.status !== 204) await checkResponse(res, "deleteGist");
}
