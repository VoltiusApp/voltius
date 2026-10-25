import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { Connection, Folder } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/sftp", () => ({ wslListDistros: async () => [] }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", useIsIOS: () => false, useIsAndroid: () => false, useIsMobile: () => false }));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));

import { RuleHosts } from "./RuleHosts";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";

const initialConn = useConnectionStore.getState();
const initialFolder = useFolderStore.getState();
const initialTeam = useTeamStore.getState();

afterEach(() => {
  cleanup();
  useConnectionStore.setState(initialConn, true);
  useFolderStore.setState(initialFolder, true);
  useTeamStore.setState(initialTeam, true);
});

function host(id: string, extra: Partial<Connection> = {}): Connection {
  return { id, name: id, host: `${id}.lan`, port: 22, username: "u", vault_id: "personal", created_at: "", ...extra } as Connection;
}

const personal = [
  host("web", { folder_id: "prod" }),
  host("db", { folder_id: "prod", last_used_at: "2026-02-01T00:00:00Z" }),
  host("console", { connection_type: "serial", serial_port: "/dev/ttyUSB0" }),
];

function seed() {
  useConnectionStore.setState({ connections: personal, teamConnections: { t1: [host("team-box", { vault_id: "t1" })] } });
  useFolderStore.setState({ folders: [{ id: "prod", name: "Prod", object_type: "connection", vault_id: "personal" } as Folder] });
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] }] as never });
}

function Harness({ initial = [] as string[] }) {
  const [selected, setSelected] = useState(initial);
  const toggle = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return <RuleHosts vaultId="personal" hosts={personal} selected={selected} onToggle={toggle} />;
}

const filter = () => screen.getByLabelText("shared.hostPicker.filterPlaceholder");
const chips = (c: HTMLElement) => [...c.querySelectorAll("[data-rule-host-chip]")].map((e) => e.getAttribute("data-rule-host-chip"));

test("lists only the rule vault's SSH hosts, in folders, under a Recent section", () => {
  seed();
  const { container } = render(<Harness />);
  expect(container.querySelector('[data-host-picker-folder="prod"]')).toBeTruthy();
  expect(container.querySelector("[data-host-picker-recent]")?.textContent).toContain("db");
  expect(screen.getByText("web")).toBeTruthy();
  expect(screen.queryByText("console")).toBeNull();
  expect(screen.queryByText("team-box")).toBeNull();
});

test("clicking hosts selects several, and a chip keeps a selection the filter hides", () => {
  seed();
  const { container } = render(<Harness />);
  fireEvent.click(screen.getByText("web"));
  fireEvent.click(screen.getAllByText("db")[0]);
  expect(chips(container)).toEqual(["web", "db"]);

  fireEvent.change(filter(), { target: { value: "web" } });
  expect(screen.queryAllByText("db").filter((e) => !e.closest("[data-rule-host-chip]"))).toHaveLength(0);
  expect(chips(container)).toEqual(["web", "db"]);

  fireEvent.click(screen.getByLabelText("portForwarding.ruleForm.removeHost:db"));
  expect(chips(container)).toEqual(["web"]);
});

test("Enter selects the first unselected match and clears the filter", () => {
  seed();
  const { container } = render(<Harness initial={["web"]} />);
  fireEvent.change(filter(), { target: { value: "lan" } });
  fireEvent.keyDown(filter(), { key: "Enter" });
  expect(chips(container)).toEqual(["web", "db"]);
  expect((filter() as HTMLInputElement).value).toBe("");
});

test("clicking a selected host unselects it", () => {
  seed();
  const { container } = render(<Harness initial={["web"]} />);
  fireEvent.click(screen.getAllByText("web").find((e) => !e.closest("[data-rule-host-chip]"))!);
  expect(chips(container)).toEqual([]);
});

test("Backspace in an empty filter keeps the selected hosts", () => {
  seed();
  const { container } = render(<Harness initial={["web", "db"]} />);
  fireEvent.keyDown(filter(), { key: "Backspace" });
  expect(chips(container)).toEqual(["web", "db"]);
});

test("the filter keeps its placeholder while hosts are selected", () => {
  seed();
  render(<Harness initial={["web"]} />);
  expect(screen.getByPlaceholderText("shared.hostPicker.filterPlaceholder")).toBeTruthy();
});
