import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import PortKnockPanel, { knockPanelIssues } from "./PortKnockPanel";
import type { StoredSecretsState } from "@/hooks/useStoredSecrets";

afterEach(cleanup);

const s = (port: number, protocol: "tcp" | "udp" = "tcp") => ({ id: String(port), port, protocol });

function renderPanel(over: Partial<Parameters<typeof PortKnockPanel>[0]> = {}) {
  const onStepsChange = vi.fn();
  const onSettingsChange = vi.fn();
  render(
    <PortKnockPanel
      settings={{ enabled: true }}
      steps={[]}
      sequenceState={"ok" as StoredSecretsState}
      onSettingsChange={onSettingsChange}
      onStepsChange={onStepsChange}
      effectiveProxyMode="none"
      bastionName={null}
      onBack={() => {}}
      {...over}
    />,
  );
  return { onStepsChange, onSettingsChange };
}

test.each([
  [{ enabled: true }, [], "socks5", ["empty"]],
  [{ enabled: true }, [s(0)], "none", ["port"]],
  [{ enabled: true }, [s(1, "udp")], "socks5", ["udp-proxy"]],
  [{ enabled: true }, [s(1, "udp")], "http", ["udp-proxy"]],
  [{ enabled: true }, [s(1, "udp")], "system", ["udp-system"]],
  [{ enabled: true }, [s(1, "udp")], "direct", []],
  [{ enabled: false }, [], "socks5", []],
] as const)("issues for %j %j via %s", (settings, steps, mode, want) => {
  expect(knockPanelIssues(settings, [...steps], mode)).toEqual(want);
});

test("adding a port appends a TCP row and stops at 16", () => {
  const { onStepsChange } = renderPanel({ steps: [s(1)] });
  fireEvent.click(screen.getByText("connections.knock.addPort").closest("button")!);
  expect(onStepsChange).toHaveBeenCalledWith([s(1), { id: expect.any(String), port: 0, protocol: "tcp" }]);
  cleanup();

  renderPanel({ steps: Array.from({ length: 16 }, (_, i) => s(i + 1)) });
  expect(screen.getByText("connections.knock.addPort").closest("button")!.disabled).toBe(true);
});

test("dragging reorders the sequence", () => {
  const steps = [s(10001), s(20002, "udp")];
  const { onStepsChange } = renderPanel({ steps });
  const handles = screen.getAllByLabelText("connections.knock.dragToReorder");
  fireEvent.mouseDown(handles[0]);
  fireEvent.mouseMove(screen.getByDisplayValue("20002").closest("[class*='rounded-lg']")!, { clientY: 10 });
  fireEvent.mouseUp(handles[0]);
  expect(onStepsChange).toHaveBeenCalledWith([steps[1], steps[0]]);
});

test("typing a port keeps digits only", () => {
  const { onStepsChange } = renderPanel({ steps: [s(10001)] });
  fireEvent.change(screen.getByDisplayValue("10001"), { target: { value: "8a0" } });
  expect(onStepsChange).toHaveBeenCalledWith([{ ...s(10001), port: 80 }]);
});

test("with jump hosts it names the bastion that gets knocked", () => {
  renderPanel({ steps: [s(1)], bastionName: "edge" });
  expect(screen.getByText("connections.knock.viaBastion")).toBeTruthy();
});

test("issues are shown under the panel, the system proxy one as a warning", () => {
  renderPanel({ steps: [s(1, "udp")], effectiveProxyMode: "system" });
  expect(screen.getByText("connections.knock.issue.udp-system").className).toContain("--t-status-warning");
});

test("a hidden sequence shows no rows and no sequence issues, but keeps the settings editable", () => {
  const { onSettingsChange } = renderPanel({ steps: [], sequenceState: "forbidden" });
  expect(screen.queryByText("connections.knock.addPort")).toBeNull();
  expect(screen.queryByText("connections.knock.issue.empty")).toBeNull();
  fireEvent.click(screen.getByRole("switch"));
  expect(onSettingsChange).toHaveBeenCalledWith({ enabled: false });
});

test("timing inputs store numbers and clear to unset", () => {
  const { onSettingsChange } = renderPanel({ settings: { enabled: true, delay_ms: 300 } });
  fireEvent.change(screen.getByDisplayValue("300"), { target: { value: "" } });
  expect(onSettingsChange).toHaveBeenLastCalledWith({ enabled: true, delay_ms: undefined });
  fireEvent.change(screen.getByPlaceholderText("—"), { target: { value: "60" } });
  expect(onSettingsChange).toHaveBeenLastCalledWith({ enabled: true, delay_ms: 300, window_secs: 60 });
});

test("timing inputs cap their length", () => {
  renderPanel();
  expect(screen.getByLabelText("connections.knock.delay").getAttribute("maxlength")).toBe("6");
  expect(screen.getByLabelText("connections.knock.settle").getAttribute("maxlength")).toBe("6");
  expect(screen.getByLabelText("connections.knock.window").getAttribute("maxlength")).toBe("5");
});
