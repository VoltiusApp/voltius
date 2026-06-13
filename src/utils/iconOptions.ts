/**
 * Pure data + filtering for the connection icon/distro picker. Kept free of the heavy
 * `virtual:lucide-subset` / iconify imports in `icons.ts` so it can be imported by the
 * node test runner (and any consumer that only needs the option list). `icons.ts`
 * re-exports these, so `@/utils/icons` importers are unaffected.
 */

export const CONNECTION_ICON_OPTIONS = [
  { group: "OS", id: "ubuntu", label: "Ubuntu" },
  { group: "OS", id: "debian", label: "Debian" },
  { group: "OS", id: "fedora", label: "Fedora" },
  { group: "OS", id: "centos", label: "CentOS" },
  { group: "OS", id: "rhel", label: "Red Hat" },
  { group: "OS", id: "arch", label: "Arch" },
  { group: "OS", id: "opensuse", label: "openSUSE" },
  { group: "OS", id: "kali", label: "Kali" },
  { group: "OS", id: "mint", label: "Linux Mint" },
  { group: "OS", id: "nixos", label: "NixOS" },
  { group: "OS", id: "gentoo", label: "Gentoo" },
  { group: "OS", id: "raspbian", label: "Raspberry Pi" },
  { group: "OS", id: "linux", label: "Linux" },
  { group: "OS", id: "proxmox", label: "Proxmox" },
  { group: "Services", id: "docker", label: "Docker" },
  { group: "Services", id: "nginx", label: "Nginx" },
  { group: "Services", id: "apache", label: "Apache" },
  { group: "Services", id: "postgresql", label: "PostgreSQL" },
  { group: "Services", id: "mysql", label: "MySQL" },
  { group: "Services", id: "mongodb", label: "MongoDB" },
  { group: "Services", id: "redis", label: "Redis" },
  { group: "Services", id: "nodejs", label: "Node.js" },
  { group: "Services", id: "python", label: "Python" },
  { group: "Services", id: "git", label: "Git" },
  { group: "Services", id: "kubernetes", label: "Kubernetes" },
  { group: "Monitoring", id: "prometheus", label: "Prometheus" },
  { group: "Monitoring", id: "grafana", label: "Grafana" },
] as const;

export type ConnectionIconId = typeof CONNECTION_ICON_OPTIONS[number]["id"];

/** Case-insensitive filter over CONNECTION_ICON_OPTIONS for the distro/icon picker.
 *  Empty/whitespace query returns the full list (stable order preserved). */
export function filterIconOptions(query: string): typeof CONNECTION_ICON_OPTIONS[number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CONNECTION_ICON_OPTIONS];
  return CONNECTION_ICON_OPTIONS.filter((o) => `${o.label} ${o.id}`.toLowerCase().includes(q));
}
