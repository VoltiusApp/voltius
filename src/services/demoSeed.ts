/**
 * Demo data for the App Store screenshots (scripts/ios-e2e/store.mjs). Only the
 * screenshot build sets VITE_DEMO_SEED=1; elsewhere main.tsx never imports this
 * module, so it stays out of the bundle. The hosts point at the runner's test
 * SSH server or at unroutable documentation addresses: none of this is real.
 */
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";

const HOSTS = [
  { name: "db-primary", host: "10.0.1.12", username: "postgres", distro: "debian", folder: "Production", tags: ["db"] },
  { name: "api-eu-west", host: "10.0.1.21", username: "deploy", distro: "ubuntu", folder: "Production", tags: ["api"] },
  { name: "staging", host: "203.0.113.40", username: "deploy", distro: "ubuntu", folder: "Production", tags: [] },
  { name: "raspberry-pi", host: "192.168.1.50", username: "pi", distro: "raspbian", folder: "Home lab", tags: [] },
  { name: "nas", host: "192.168.1.10", username: "admin", distro: "debian", folder: "Home lab", tags: [] },
  { name: "vps-paris", host: "198.51.100.7", username: "root", distro: "alpine", folder: undefined, tags: [] },
] as const;

const SNIPPETS = [
  { name: "Disk usage", content: "df -h | grep -v tmpfs", favorite: true },
  { name: "Restart nginx", content: "sudo systemctl restart nginx && systemctl status nginx --no-pager", favorite: true },
  { name: "Tail app logs", content: "journalctl -u app -f -n 100", favorite: false },
  { name: "Docker cleanup", content: "docker system prune -af --volumes", favorite: false },
  { name: "Top processes", content: "ps aux --sort=-%mem | head -15", favorite: false },
];

export async function seedDemo(): Promise<string> {
  const folders = useFolderStore.getState();
  const folderIds = new Map<string, string>();
  for (const name of ["Production", "Home lab"]) {
    const f = await folders.saveFolder({ name, object_type: "connection" });
    folderIds.set(name, f.id);
  }
  const connections = useConnectionStore.getState();
  for (const h of HOSTS) {
    await connections.saveConnection({
      name: h.name,
      host: h.host,
      port: 22,
      username: h.username,
      distro: h.distro,
      tags: [...h.tags],
      folder_id: h.folder ? folderIds.get(h.folder) : undefined,
      ping_disabled: true,
    });
  }
  const snippets = useSnippetStore.getState();
  for (const s of SNIPPETS) {
    await snippets.createSnippet({
      name: s.name,
      steps: [{ kind: "script", content: s.content }],
      tags: [],
      favorite: s.favorite,
      only_for_connection_tags: [],
      only_for_distros: [],
    });
  }
  return `seeded ${HOSTS.length} hosts, ${SNIPPETS.length} snippets`;
}
