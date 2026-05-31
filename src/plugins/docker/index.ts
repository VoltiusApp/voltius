import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { DockerPanel } from "./components/DockerPanel";
import { initDockerRuntime } from "./runtime";

export const manifest: PluginManifest = {
  id: "plugin-docker",
  name: "Docker",
  version: "1.1.0",
  description: "Manage Docker containers, images, volumes, and networks for local and SSH sessions.",
  permissions: ["sessions:read", "right-panel", "storage", "notifications"],
  defaultEnabled: true,
  contributes: {
    configuration: {
      autoCheck: {
        type: "boolean",
        default: false,
        label: "Automatic update checks",
        description:
          "Check images against their registries when the Images view opens. A manual “check updates” button is always available regardless of this setting.",
      },
      intervalHours: {
        type: "number",
        default: 12,
        min: 1,
        max: 168,
        label: "Re-check interval (hours)",
        description:
          "Cached results are reused within this window to avoid registry rate limits. Resolving registry digests uses docker buildx; hosts without it show images as “unknown” rather than reporting a false update.",
      },
      recreateAfterPull: {
        type: "boolean",
        default: true,
        label: "Recreate containers after pulling",
        description:
          "After pulling an update, recreate the containers using that image so they actually run the new version. Compose services are recreated via compose; standalone containers are rebuilt from their docker run config. When off, the image is only pulled.",
      },
    },
  },
};

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initDockerRuntime(api);
  return api.ui.registerRightPanelSection({
    id: "docker",
    label: "Docker",
    icon: "mdi:docker",
    component: DockerPanel,
  });
};
