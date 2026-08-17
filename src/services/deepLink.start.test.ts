import { test, expect, beforeEach, vi } from "vitest";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { startDeepLinks } from "./deepLink";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const URL_A = `voltius://join?s=${SESSION}&t=tok`;

const getCurrent = vi.fn();
const onOpenUrl = vi.fn();
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: () => getCurrent(),
  onOpenUrl: (cb: (urls: string[]) => void) => onOpenUrl(cb),
}));

beforeEach(() => {
  getCurrent.mockReset().mockResolvedValue(null);
  onOpenUrl.mockReset().mockResolvedValue(() => {});
  useDeepLinkStore.setState({ ready: true, queue: [], prompt: null });
});

test("a cold-start url is handled", async () => {
  getCurrent.mockResolvedValue([URL_A]);
  startDeepLinks();
  await vi.waitFor(() =>
    expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(SESSION),
  );
});

test("a warm url delivered through onOpenUrl is handled", async () => {
  startDeepLinks();
  await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
  onOpenUrl.mock.calls[0][0]([URL_A]);
  expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(SESSION);
});

test("the same url from both paths prompts once", async () => {
  getCurrent.mockResolvedValue([URL_A]);
  startDeepLinks();
  await vi.waitFor(() =>
    expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(SESSION),
  );
  const first = useDeepLinkStore.getState().prompt;
  await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
  onOpenUrl.mock.calls[0][0]([URL_A]);
  expect(useDeepLinkStore.getState().prompt).toBe(first);
});

test("a plugin failure does not throw", async () => {
  getCurrent.mockRejectedValue(new Error("unsupported platform"));
  expect(() => startDeepLinks()).not.toThrow();
});
