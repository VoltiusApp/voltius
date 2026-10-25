import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ mobile: true }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", isMobileShell: () => h.mobile }));

import { openPortForwardingPage } from "./portForwardingNav";
import { useMobileNavStore } from "@/stores/mobileNavStore";

beforeEach(() => {
  h.mobile = true;
  useMobileNavStore.setState({ stack: [] });
});

test("on mobile it pushes the port forwarding page once, even when tapped again", () => {
  openPortForwardingPage();
  openPortForwardingPage();
  expect(useMobileNavStore.getState().stack).toEqual([{ kind: "more-page", page: "port-forwarding" }]);
});
