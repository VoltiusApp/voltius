import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin, ResolvedConfig } from "vite";

export const VIRTUAL_ID = "virtual:lucide-subset";
const RESOLVED_ID = "\0virtual:lucide-subset";

interface IconifyJSON {
  prefix: string;
  icons: Record<string, unknown>;
  width?: number;
  height?: number;
}

function walkSrc(dir: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      result.push(...walkSrc(full));
    } else if (/\.[jt]sx?$/.test(name)) {
      result.push(full);
    }
  }
  return result;
}

export function lucideSubset(): Plugin {
  const require = createRequire(import.meta.url);
  const lucideData = require("@iconify-json/lucide/icons.json") as IconifyJSON;
  let isDev = false;

  return {
    name: "lucide-subset",

    configResolved(config: ResolvedConfig) {
      isDev = config.command === "serve";
    },

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id: string) {
      if (id !== RESOLVED_ID) return;

      // Dev: serve the full set so new icons are never silently missing
      if (isDev) {
        return `export default ${JSON.stringify(lucideData)}`;
      }

      // Build: scan src/ and emit only icons referenced as "lucide:<name>"
      const srcDir = join(process.cwd(), "src");
      const used = new Set<string>();

      for (const file of walkSrc(srcDir)) {
        const content = readFileSync(file, "utf-8");
        for (const [, name] of content.matchAll(/lucide:([a-z0-9-]+)/g)) {
          used.add(name);
        }
      }

      const icons: Record<string, unknown> = {};
      for (const name of used) {
        if (lucideData.icons[name]) {
          icons[name] = lucideData.icons[name];
        } else {
          this.warn(`[lucide-subset] icon not found in @iconify-json/lucide: "${name}"`);
        }
      }

      const total = Object.keys(lucideData.icons).length;
      console.log(`\n[lucide-subset] bundling ${used.size} of ${total} Lucide icons\n`);

      return `export default ${JSON.stringify({
        prefix: "lucide",
        icons,
        width: lucideData.width,
        height: lucideData.height,
      })}`;
    },
  };
}
