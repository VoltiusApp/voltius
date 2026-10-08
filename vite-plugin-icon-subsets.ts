import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin, ResolvedConfig } from "vite";
import { DEVICON_PLAIN_NAMES } from "./src/utils/deviconPlainNames";

const LUCIDE_ID = "virtual:lucide-subset";
const DEVICON_PLAIN_ID = "virtual:devicon-plain-subset";

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

function usedLucideNames(): Set<string> {
  const used = new Set<string>();
  for (const file of walkSrc(join(process.cwd(), "src"))) {
    const content = readFileSync(file, "utf-8");
    for (const [, name] of content.matchAll(/lucide:([a-z0-9-]+)/g)) used.add(name);
  }
  return used;
}

function subset(data: IconifyJSON, names: Iterable<string>, warn: (msg: string) => void): IconifyJSON {
  const icons: Record<string, unknown> = {};
  for (const name of names) {
    if (data.icons[name]) icons[name] = data.icons[name];
    else warn(`[icon-subsets] icon not found in @iconify-json/${data.prefix}: "${name}"`);
  }
  return { prefix: data.prefix, icons, width: data.width, height: data.height };
}

/** Emits only the icons the app uses, so the full Iconify sets never reach the bundle. */
export function iconSubsets(): Plugin {
  const require = createRequire(import.meta.url);
  const load = (pkg: string) => require(`@iconify-json/${pkg}/icons.json`) as IconifyJSON;
  let isDev = false;

  return {
    name: "icon-subsets",

    configResolved(config: ResolvedConfig) {
      isDev = config.command === "serve";
    },

    resolveId(id: string) {
      if (id === LUCIDE_ID || id === DEVICON_PLAIN_ID) return `\0${id}`;
    },

    load(id: string) {
      const warn = (msg: string) => this.warn(msg);
      if (id === `\0${DEVICON_PLAIN_ID}`) {
        return `export default ${JSON.stringify(subset(load("devicon-plain"), DEVICON_PLAIN_NAMES, warn))}`;
      }
      if (id !== `\0${LUCIDE_ID}`) return;
      const lucide = load("lucide");
      // Dev serves the full set so a new icon is never silently missing.
      if (isDev) return `export default ${JSON.stringify(lucide)}`;
      const used = usedLucideNames();
      console.log(`\n[icon-subsets] bundling ${used.size} of ${Object.keys(lucide.icons).length} Lucide icons\n`);
      return `export default ${JSON.stringify(subset(lucide, used, warn))}`;
    },
  };
}
