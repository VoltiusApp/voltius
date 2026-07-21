import type { DockerContainer, DockerImage, DockerVolume, DockerNetwork, DockerStack } from "./types";

function hit(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f != null && f.toLowerCase().includes(q));
}

export function matchContainer(c: DockerContainer, q: string): boolean {
  return hit(q, c.names.join(" "), c.image, c.status, c.state);
}

export function matchImage(i: DockerImage, q: string): boolean {
  return hit(q, i.repo_tags.join(" "), i.id);
}

export function matchVolume(v: DockerVolume, q: string): boolean {
  return hit(q, v.name, v.driver);
}

export function matchNetwork(n: DockerNetwork, q: string): boolean {
  return hit(q, n.name, n.driver, n.id);
}

export function matchStack(s: DockerStack, q: string): boolean {
  return hit(q, s.name, s.status);
}
