import { test, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TunnelStatusDot } from "./TunnelStatusDot";
import i18n from "@/i18n";

afterEach(() => cleanup());
beforeAll(async () => { await i18n.changeLanguage("en"); });

function dot(props: Parameters<typeof TunnelStatusDot>[0]) {
  const wrapper = render(<TunnelStatusDot {...props} />).container.firstChild as HTMLElement;
  return { wrapper, mark: wrapper.firstElementChild as HTMLElement };
}

test("a live forward to a live remote is a solid green dot", () => {
  const { wrapper, mark } = dot({ status: "active", remoteListening: true });
  expect(mark.className).toContain("bg-green-500");
  expect(mark.className).not.toContain("border-2");
  expect(wrapper.getAttribute("title")).toBe(null);
});

test("nothing listening hollows the dot without changing the hue", () => {
  const { wrapper, mark } = dot({ status: "active", remoteListening: false });
  expect(mark.className).toContain("border-green-500");
  expect(mark.className).toContain("border-2");
  expect(mark.className).not.toContain("bg-green-500");
  expect(wrapper.getAttribute("title")).toBe("Nothing is listening on the remote port");
});

test("unknown liveness renders solid, like a live one", () => {
  for (const remoteListening of [undefined, null]) {
    const { mark } = dot({ status: "active", remoteListening });
    expect(mark.className).toContain("bg-green-500");
    expect(mark.className).not.toContain("border-2");
  }
});

test("our own health keeps the hue channel", () => {
  expect(dot({ status: "error" }).mark.className).toContain("bg-red-500");
  expect(dot({ status: "idle" }).mark.className).toContain("--t-text-dim");
  expect(dot({ status: "error", remoteListening: false }).mark.className).toContain("border-red-500");
});
