// Dotted-path access over plain JSON objects. Arrays are opaque values, not
// traversable containers: every caller addresses settings-bundle leaves, and a
// numeric index there would be a position, not a stable identity.

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function walk(obj: unknown, segments: string[]): Rec | undefined {
  let cur = obj;
  for (const s of segments) {
    if (!isRec(cur)) return undefined;
    cur = cur[s];
  }
  return isRec(cur) ? cur : undefined;
}

function resolve(obj: unknown, path: string): { parent: Rec | undefined; key: string } {
  const segments = path.split(".");
  return { parent: walk(obj, segments.slice(0, -1)), key: segments[segments.length - 1] };
}

export function getPath(obj: unknown, path: string): unknown {
  const { parent, key } = resolve(obj, path);
  return parent?.[key];
}

export function hasPath(obj: unknown, path: string): boolean {
  const { parent, key } = resolve(obj, path);
  return parent !== undefined && key in parent;
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  if (!isRec(obj)) return;
  const segments = path.split(".");
  let cur: Rec = obj;
  for (const s of segments.slice(0, -1)) {
    if (!isRec(cur[s])) cur[s] = {};
    cur = cur[s] as Rec;
  }
  cur[segments[segments.length - 1]] = value;
}

export function deletePath(obj: unknown, path: string): void {
  const { parent, key } = resolve(obj, path);
  if (parent) delete parent[key];
}
