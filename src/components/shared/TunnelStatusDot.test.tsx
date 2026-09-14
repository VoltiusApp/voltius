import { test, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TunnelStatusDot } from "./TunnelStatusDot";
import i18n from "@/i18n";

afterEach(() => cleanup());
beforeAll(async () => { await i18n.changeLanguage("en"); });

function dot(props: Parameters<typeof TunnelStatusDot>[0]) {
  const wrapper = render(<TunnelStatusDot {...props} />).container.firstChild as HTMLElement;
  const mark = wrapper.firstElementChild as Element;
  return { wrapper, tag: mark.tagName, cls: mark.getAttribute("class") ?? "" };
}

test("a live forward to a live remote is a solid green dot", () => {
  const { wrapper, tag, cls } = dot({ status: "active", remoteListening: true });
  expect(tag).toBe("SPAN");
  expect(cls).toContain("bg-green-500");
  expect(wrapper.getAttribute("title")).toBe(null);
});

test("nothing listening hollows the dot without changing the hue", () => {
  const { wrapper, tag, cls } = dot({ status: "active", remoteListening: false });
  expect(tag).toBe("svg");
  expect(cls).toContain("text-green-500");
  expect(cls).not.toContain("bg-green-500");
  expect(wrapper.getAttribute("title")).toBe("Nothing is listening on the remote port");
});

test("unknown liveness renders solid, like a live one", () => {
  for (const remoteListening of [undefined, null]) {
    const { tag, cls } = dot({ status: "active", remoteListening });
    expect(tag).toBe("SPAN");
    expect(cls).toContain("bg-green-500");
  }
});

test("our own health keeps the hue channel", () => {
  expect(dot({ status: "error" }).cls).toContain("bg-red-500");
  expect(dot({ status: "idle" }).cls).toContain("--t-text-dim");
  expect(dot({ status: "error", remoteListening: false }).cls).toContain("text-red-500");
});
