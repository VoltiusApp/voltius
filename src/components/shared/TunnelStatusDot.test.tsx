import { test, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TunnelStatusDot } from "./TunnelStatusDot";
import i18n from "@/i18n";

afterEach(() => cleanup());
beforeAll(async () => { await i18n.changeLanguage("en"); });

function dot(props: Parameters<typeof TunnelStatusDot>[0]) {
  const wrapper = render(<TunnelStatusDot {...props} />).container.firstChild as HTMLElement;
  const mark = wrapper.lastElementChild as HTMLElement;
  return { wrapper, tag: mark.tagName, style: mark.getAttribute("style") ?? "" };
}

test("a live forward to a live remote is a solid connected dot", () => {
  const { wrapper, tag, style } = dot({ status: "active", remoteListening: true });
  expect(tag).toBe("SPAN");
  expect(style).toContain("--t-status-connected");
  expect(wrapper.getAttribute("title")).toBe(null);
});

test("nothing listening hollows the dot without changing the hue", () => {
  const { wrapper, tag, style } = dot({ status: "active", remoteListening: false });
  expect(tag).toBe("svg");
  expect(style).toContain("--t-status-connected");
  expect(wrapper.getAttribute("title")).toBe("Nothing is listening on the remote port");
});

test("unknown liveness renders solid, like a live one", () => {
  for (const remoteListening of [undefined, null]) {
    const { tag, style } = dot({ status: "active", remoteListening });
    expect(tag).toBe("SPAN");
    expect(style).toContain("--t-status-connected");
  }
});

test("our own health keeps the hue channel", () => {
  expect(dot({ status: "error" }).style).toContain("--t-status-error");
  expect(dot({ status: "idle" }).style).toContain("--t-text-muted");
  expect(dot({ status: "error", remoteListening: false }).style).toContain("--t-status-error");
});
