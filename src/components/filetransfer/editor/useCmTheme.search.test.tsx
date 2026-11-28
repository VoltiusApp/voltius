import { afterEach, beforeAll, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { openSearchPanel } from "@codemirror/search";
import { useCmTheme } from "./useCmTheme";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(cleanup);

let rerender: () => void = () => {};

function Editor() {
  const [, setTick] = useState(0);
  rerender = () => setTick((n) => n + 1);
  return <CodeMirror value="PubkeyAuthentication yes" extensions={useCmTheme()} onChange={() => {}} />;
}

it("the search panel stays open when the editor re-renders", async () => {
  render(<Editor />);
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
  act(() => { openSearchPanel(view); });
  expect(document.querySelector(".cm-search")).toBeTruthy();

  await act(async () => { rerender(); });

  expect(document.querySelector(".cm-search")).toBeTruthy();
});
