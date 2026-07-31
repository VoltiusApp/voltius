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

  test("a read-tier perm gets the read-only heading, not the danger heading", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["storage", "docker:read"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.getByText("settings.plugins.permissionModal.permissions.readOnlyHeading")).toBeTruthy();
    expect(screen.queryByText("settings.plugins.permissionModal.permissions.dangerHeading")).toBeNull();
    expect(screen.getByText("settings.plugins.permissionModal.permissions.dockerRead.label")).toBeTruthy();
  });

  test("read and manage tiers land in separate blocks when both are declared", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["docker:read", "docker:manage"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.getByText("settings.plugins.permissionModal.permissions.readOnlyHeading")).toBeTruthy();
    expect(screen.getByText("settings.plugins.permissionModal.permissions.dangerHeading")).toBeTruthy();
  });

  test("no read-only heading when nothing is on the read tier", () => {
    render(
      <PluginPermissionModal
        mode="install" pluginName="Test" permissions={["storage", "terminal:write"]}
        onConfirm={() => {}} onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("settings.plugins.permissionModal.permissions.readOnlyHeading")).toBeNull();
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
