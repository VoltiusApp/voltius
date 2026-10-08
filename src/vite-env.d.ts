/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module "virtual:lucide-subset" {
  const data: import("@iconify/types").IconifyJSON;
  export default data;
}

declare module "virtual:devicon-plain-subset" {
  const data: import("@iconify/types").IconifyJSON;
  export default data;
}
