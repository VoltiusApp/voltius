import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

const { getDeviceSteps } = await import("./constants");
const { activateStep, createSteps } = await import("./utils");
const { ConnectionSteps } = await import("./ConnectionSteps");

const configs = getDeviceSteps("Desktop-PC");
const view = (steps: ReturnType<typeof createSteps>) => steps.map((s) => [s.id, s.status]);

describe("device connect steps", () => {
  test("an always-allowed device never lists the approval step", () => {
    const dialing = activateStep(createSteps(configs), configs, "device_dialing", "");
    expect(view(dialing)).toEqual([["device_dialing", "active"]]);
  });

  test("the approval step appears once the backend reports it", () => {
    const dialing = activateStep(createSteps(configs), configs, "device_dialing", "");
    const waiting = activateStep(dialing, configs, "device_approval", "");
    expect(view(waiting)).toEqual([["device_dialing", "done"], ["device_approval", "active"]]);
    expect(waiting[1].label).toBe("fileTransfer.connect.deviceApproval");
  });

  test("an empty detail draws no detail line", () => {
    const { container } = render(<ConnectionSteps steps={activateStep(createSteps(configs), configs, "device_dialing", "")} />);
    expect(container.querySelector("p")).toBeNull();
  });
});
