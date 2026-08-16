import { test, expect, beforeEach, vi } from "vitest";
import { handleDeepLink } from "./deepLink";
import { useDeepLinkStore } from "@/stores/deepLinkStore";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "11111111-2222-3333-4444-555555555555";
const link = (s: string) => `voltius://join?s=${s}&t=tok`;

beforeEach(() => {
  useDeepLinkStore.setState({ ready: false, pending: null, prompt: null });
});

test("a link arriving before ready is queued, not prompted", () => {
  handleDeepLink(link(SESSION));
  const s = useDeepLinkStore.getState();
  expect(s.prompt).toBeNull();
  expect(s.pending?.sessionId).toBe(SESSION);
});

test("becoming ready drains the queued intent into the prompt", () => {
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().setReady(true);
  const s = useDeepLinkStore.getState();
  expect(s.prompt?.sessionId).toBe(SESSION);
  expect(s.pending).toBeNull();
});

test("a link arriving while ready prompts immediately", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(SESSION);
});

test("a warm echo while the prompt is open does not re-prompt", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  const first = useDeepLinkStore.getState().prompt;
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt).toBe(first);
});

test("a duplicate arriving before ready does not replace the queued intent", () => {
  handleDeepLink(link(SESSION));
  const first = useDeepLinkStore.getState().pending;
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().pending).toBe(first);
});

test("dismissing then redelivering the same link prompts again", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().dismissPrompt();
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(SESSION);
});

test("a different link supersedes the pending one", () => {
  handleDeepLink(link(SESSION));
  handleDeepLink(link(OTHER));
  expect(useDeepLinkStore.getState().pending?.sessionId).toBe(OTHER);
});

test("an unknown route is dropped without prompting or throwing", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(`voltius://vault?s=${SESSION}&t=tok`);
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

test("dropping a link never logs the query string", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  handleDeepLink(`voltius://vault?s=${SESSION}&t=tokenmustnotbelogged`);
  const logged = warn.mock.calls.flat().join(" ");
  expect(logged).not.toContain("tokenmustnotbelogged");
  warn.mockRestore();
});

test("a different link while a prompt is on screen queues as pending, leaving prompt untouched", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  const shown = useDeepLinkStore.getState().prompt;
  handleDeepLink(link(OTHER));
  const s = useDeepLinkStore.getState();
  expect(s.prompt).toBe(shown);
  expect(s.pending?.sessionId).toBe(OTHER);
  s.dismissPrompt();
  expect(useDeepLinkStore.getState().prompt?.sessionId).toBe(OTHER);
});

test("dismissing clears the prompt", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().dismissPrompt();
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});
