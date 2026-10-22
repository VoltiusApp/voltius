/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /** "play" for the Google Play bundle; unset everywhere else. */
  readonly VITE_DISTRIBUTION?: string;
}

declare module "virtual:lucide-subset" {
  const data: import("@iconify/types").IconifyJSON;
  export default data;
}

declare module "virtual:devicon-plain-subset" {
  const data: import("@iconify/types").IconifyJSON;
  export default data;
}
