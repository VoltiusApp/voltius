import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListenerFields, RouteSummary } from "./RuleRoute";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values: Record<string, string> }) => <>{`${i18nKey} ${values.listener} ${values.target}`}</>,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const writeClipboard = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const A = "portForwarding.ruleForm.audience";

function listener(bindHost: string, side: "computer" | "server" = "computer") {
  const onBindHost = vi.fn();
  render(<ListenerFields side={side} portLabel="port" portPlaceholder="3000" port="8080" onPort={() => {}} bindHost={bindHost} onBindHost={onBindHost} />);
  return onBindHost;
}

describe("ListenerFields", () => {
  it("stores loopback and the wildcard for the two named choices", () => {
    const onBindHost = listener("127.0.0.1");
    expect(screen.queryByText("portForwarding.ruleForm.sharedWarning.computer")).toBeNull();

    fireEvent.click(screen.getByText(`${A}.network`));
    expect(onBindHost).toHaveBeenLastCalledWith("0.0.0.0");
    expect(screen.getByText("portForwarding.ruleForm.sharedWarning.computer")).toBeTruthy();

    fireEvent.click(screen.getByText(`${A}.thisComputer`));
    expect(onBindHost).toHaveBeenLastCalledWith("127.0.0.1");
  });

  it("asks for an address only under Custom, starting from blank", () => {
    const onBindHost = listener("127.0.0.1");
    expect(screen.queryByLabelText(`${A}.customAddress`)).toBeNull();

    fireEvent.click(screen.getByText(`${A}.custom`));
    expect(onBindHost).toHaveBeenLastCalledWith("");
    fireEvent.change(screen.getByLabelText(`${A}.customAddress`), { target: { value: "192.168.1.2" } });
    expect(onBindHost).toHaveBeenLastCalledWith("192.168.1.2");
  });

  it("opens on Custom for a stored address and keeps it when Custom is picked again", () => {
    const onBindHost = listener("192.168.1.2", "server");
    expect((screen.getByLabelText(`${A}.customAddress`) as HTMLInputElement).value).toBe("192.168.1.2");
    expect(screen.getByText(`${A}.serverOnly`)).toBeTruthy();
    expect(screen.getByText("portForwarding.ruleForm.sharedWarning.server")).toBeTruthy();

    fireEvent.click(screen.getByText(`${A}.custom`));
    expect(onBindHost).not.toHaveBeenCalled();
  });
});

describe("RouteSummary", () => {
  it("asks for the ports until there is a route to describe", () => {
    render(<RouteSummary summary={null} />);
    expect(screen.getByText("portForwarding.ruleForm.summary.incomplete")).toBeTruthy();
    expect(screen.queryByTitle("portForwarding.ruleForm.summary.copyCommand")).toBeNull();
  });

  it("says where traffic goes and copies the matching command", () => {
    render(<RouteSummary summary={{ variant: "localShared", listener: "192.168.1.2:8080", target: "db:80", command: "ssh -L 192.168.1.2:8080:db:80 <host>" }} />);
    expect(screen.getByText("portForwarding.ruleForm.summary.localShared 192.168.1.2:8080 db:80")).toBeTruthy();

    fireEvent.click(screen.getByTitle("portForwarding.ruleForm.summary.copyCommand"));
    expect(writeClipboard).toHaveBeenCalledWith("ssh -L 192.168.1.2:8080:db:80 <host>");
  });
});
