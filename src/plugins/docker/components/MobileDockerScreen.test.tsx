import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DockerContainer } from "../types";
import type { PluginAPI, PluginSession } from "@/plugins/api";

// Iconify loads icon data asynchronously; its timers can outlive this file's
// jsdom teardown and throw in whichever test runs next (see other *.test.tsx
// files in this repo for the same workaround).
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));

const h = vi.hoisted(() => ({
  containers: [] as DockerContainer[],
}));

vi.mock("../services", () => ({
  createMobileDockerListService: () => ({
    list: vi.fn(async () => h.containers),
    action: vi.fn(async () => {}),
    openExecTerminal: vi.fn(async () => {}),
  }),
}));

import { createMobileDockerScreen } from "./MobileDockerScreen";

const session: PluginSession = {
  id: "s1",
  connectionId: "conn1",
  connectionName: "prod-box",
  status: "connected",
  type: "ssh",
};

function makeApi(): PluginAPI {
  return {
    i18n: { t: (k: string) => k, getLocale: () => "en", onLocaleChange: () => () => {} },
    sessions: {
      list: () => [session],
      getActive: () => session,
      onActivated: () => () => {},
      onConnected: () => () => {},
      onDisconnected: () => () => {},
    },
    ui: { pushMobileScreen: vi.fn(), focusMobileTerminal: vi.fn(), setActiveNav: vi.fn() },
    notifications: { toast: vi.fn() },
    storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
  } as unknown as PluginAPI;
}

function container(): DockerContainer {
  return {
    id: "c1",
    names: ["/web"],
    image: "nginx",
    status: "Up 2 minutes",
    state: "running",
    ports: [{ host_ip: "0.0.0.0", host_port: 8080, container_port: 80, protocol: "tcp" }],
    created: 0,
  };
}

/** Lets the initial container list load settle. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(cleanup);

describe("MobileDockerScreen row", () => {
  test("carries data-mobile-docker-container and renders its port chips inside it (no nested-button violation)", async () => {
    h.containers = [container()];
    const Screen = createMobileDockerScreen(makeApi());
    render(<Screen sessionId="s1" onBack={vi.fn()} />);
    await settle();

    const row = document.querySelector('[data-mobile-docker-container="c1"]');
    expect(row).toBeTruthy();
    expect(row!.tagName).not.toBe("BUTTON");
    expect(row!.getAttribute("role")).toBe("button");
    expect(row!.querySelector("button")).toBeTruthy(); // the port chip renders inside it
  });

  test("a mouse click on the row opens the action sheet", async () => {
    h.containers = [container()];
    const Screen = createMobileDockerScreen(makeApi());
    render(<Screen sessionId="s1" onBack={vi.fn()} />);
    await settle();

    await userEvent.click(document.querySelector('[data-mobile-docker-container="c1"]')!);
    expect(screen.getByText("hostStop")).toBeTruthy(); // sheet action label from actionsFor("running")
  });

  test("pressing Enter on the row opens the action sheet", async () => {
    h.containers = [container()];
    const Screen = createMobileDockerScreen(makeApi());
    render(<Screen sessionId="s1" onBack={vi.fn()} />);
    await settle();

    const row = document.querySelector('[data-mobile-docker-container="c1"]') as HTMLElement;
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hostStop")).toBeTruthy();
  });

  test("pressing Space on the row opens the action sheet", async () => {
    h.containers = [container()];
    const Screen = createMobileDockerScreen(makeApi());
    render(<Screen sessionId="s1" onBack={vi.fn()} />);
    await settle();

    const row = document.querySelector('[data-mobile-docker-container="c1"]') as HTMLElement;
    row.focus();
    await userEvent.keyboard(" ");
    expect(screen.getByText("hostStop")).toBeTruthy();
  });
});
