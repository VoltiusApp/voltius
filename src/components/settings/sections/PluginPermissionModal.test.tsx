import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PluginPermissionModal } from "./PluginPermissionModal";

// react-i18next: return the key so we can assert which copy key rendered.
import { vi } from "vitest";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k) }),
}));

afterEach(cleanup);

describe("PluginPermissionModal", () => {
  test("renders the label + description for a known perm", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["connections:read"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.getByText("settings.plugins.permissionModal.permissions.connectionsRead.label")).toBeTruthy();
    expect(screen.getByText("settings.plugins.permissionModal.permissions.connectionsRead.description")).toBeTruthy();
  });

  test("shows the danger heading + warning when a gated perm is declared", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["storage", "terminal:write"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.getByText("settings.plugins.permissionModal.permissions.dangerHeading")).toBeTruthy();
    expect(screen.getByText("settings.plugins.permissionModal.permissions.terminalWrite.label")).toBeTruthy();
  });

  test("no danger heading when only benign perms are declared", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["storage", "http"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("settings.plugins.permissionModal.permissions.dangerHeading")).toBeNull();
  });

  test("an unknown perm renders its bare string", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["some:future-perm"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.getByText("some:future-perm")).toBeTruthy();
  });
});
