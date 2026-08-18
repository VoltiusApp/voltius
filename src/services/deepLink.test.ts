import { test, expect, beforeEach, vi } from "vitest";
import { handleDeepLink } from "./deepLink";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import type { DeepLinkIntent } from "@/services/deepLinkUrl";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "11111111-2222-3333-4444-555555555555";
const link = (s: string) => `voltius://join?s=${s}&t=tok`;

beforeEach(() => {
  useDeepLinkStore.setState({ ready: false, queue: [], prompt: null });
  useDeepLinkStore.getState().setUnpromptedHandler(null);
});

test("a link arriving before ready is queued, not prompted", () => {
  handleDeepLink(link(SESSION));
  const s = useDeepLinkStore.getState();
  expect(s.prompt).toBeNull();
  expect(s.queue).toHaveLength(1);
});

test("becoming ready drains the queued intent into the prompt", () => {
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().setReady(true);
  const s = useDeepLinkStore.getState();
  expect(s.prompt).toMatchObject({ route: "join", sessionId: SESSION });
  expect(s.queue).toHaveLength(0);
});

test("a link arriving while ready prompts immediately", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
});

test("a warm echo while the prompt is open does not re-prompt", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  const first = useDeepLinkStore.getState().prompt;
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt).toBe(first);
});

test("a duplicate arriving before ready is dropped", () => {
  handleDeepLink(link(SESSION));
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().queue).toHaveLength(1);
});

test("dismissing then redelivering the same link prompts again", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().dismissPrompt();
  handleDeepLink(link(SESSION));
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
});

test("two different links queued before ready are both delivered, in order", () => {
  handleDeepLink(link(SESSION));
  handleDeepLink(link(OTHER));
  useDeepLinkStore.getState().setReady(true);
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
  useDeepLinkStore.getState().dismissPrompt();
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: OTHER });
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

test("a different link while a prompt is on screen queues behind it", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  const shown = useDeepLinkStore.getState().prompt;
  handleDeepLink(link(OTHER));
  const s = useDeepLinkStore.getState();
  expect(s.prompt).toBe(shown);
  expect(s.queue).toHaveLength(1);
  s.dismissPrompt();
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: OTHER });
});

test("dismissing clears the prompt", () => {
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  useDeepLinkStore.getState().dismissPrompt();
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

const USER = "9f1e2d3c-4b5a-6978-8765-43210fedcba9";
const OTHER_USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("two verified links for different users both reach the silent handler", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(`voltius://verified?u=${USER}`);
  handleDeepLink(`voltius://verified?u=${OTHER_USER}`);
  expect(seen).toEqual([USER, OTHER_USER]);
});

test("a silent link does not wait behind an open prompt", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  handleDeepLink(`voltius://verified?u=${USER}`);
  expect(seen).toEqual([USER]);
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
});

test("a silent link arriving before ready runs once ready", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
  handleDeepLink(`voltius://verified?u=${USER}`);
  expect(seen).toEqual([]);
  useDeepLinkStore.getState().setReady(true);
  expect(seen).toEqual([USER]);
});

test("the same silent link delivered twice reaches the handler once", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(`voltius://verified?u=${USER}`);
  handleDeepLink(`voltius://verified?u=${USER}`);
  expect(seen).toEqual([USER]);
});

test("the same silent link delivered again after the echo window reaches the handler again", () => {
  vi.useFakeTimers();
  try {
    const seen: string[] = [];
    useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
    useDeepLinkStore.getState().setReady(true);
    handleDeepLink(`voltius://verified?u=${USER}`);
    vi.advanceTimersByTime(5001);
    handleDeepLink(`voltius://verified?u=${USER}`);
    expect(seen).toEqual([USER, USER]);
  } finally {
    vi.useRealTimers();
  }
});

test("a link enqueued by a silent handler survives the drain that ran it", () => {
  useDeepLinkStore.getState().setUnpromptedHandler(() => handleDeepLink(link(SESSION)));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(`voltius://verified?u=${USER}`);
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
  expect(useDeepLinkStore.getState().queue).toHaveLength(0);
});

// The cast is the point: a future route whose trust class the store does not
// recognise must be dropped, not fall through to the unprompted handler.
test("an intent of an unknown trust class is dropped rather than acted on", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route === "verified" ? i.userId : i.route));
  useDeepLinkStore.getState().setReady(true);
  useDeepLinkStore.getState().enqueue({ route: "future" } as unknown as DeepLinkIntent);
  const s = useDeepLinkStore.getState();
  expect(seen).toEqual([]);
  expect(s.prompt).toBeNull();
  expect(s.queue).toHaveLength(0);
});

test("the queue drops the oldest beyond its cap", () => {
  const ids = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    "44444444-4444-4444-4444-444444444444",
    "55555555-5555-5555-5555-555555555555",
  ];
  ids.forEach((id) => handleDeepLink(link(id)));
  const queued = useDeepLinkStore.getState().queue;
  expect(queued).toHaveLength(4);
  expect(queued[0]).toMatchObject({ sessionId: ids[1] });
});

test("a navigate link reaches the handler without opening a prompt", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink("voltius://settings?section=vaults");
  handleDeepLink("voltius://billing");
  expect(seen).toEqual(["settings", "billing"]);
  expect(useDeepLinkStore.getState().prompt).toBeNull();
});

test("a navigate link does not wait behind an open prompt", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink(link(SESSION));
  handleDeepLink("voltius://notification?n=invite%3A42");
  expect(seen).toEqual(["notification"]);
  expect(useDeepLinkStore.getState().prompt).toMatchObject({ route: "join", sessionId: SESSION });
});

test("the same navigate link delivered twice reaches the handler once", () => {
  const seen: string[] = [];
  useDeepLinkStore.getState().setUnpromptedHandler((i) => seen.push(i.route));
  useDeepLinkStore.getState().setReady(true);
  handleDeepLink("voltius://settings?section=vaults");
  handleDeepLink("voltius://settings?section=vaults");
  expect(seen).toEqual(["settings"]);
});
