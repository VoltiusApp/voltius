import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/sftp", () => ({ pickLocalPath: vi.fn() }));
vi.mock("@/components/snippets/VariableTextarea", () => ({ VariableTextarea: () => null }));

import { StepListEditor } from "./StepListEditor";
import type { SnippetStep } from "@/types";

afterEach(cleanup);

const steps: SnippetStep[] = [
  { kind: "script", content: "one" },
  { kind: "script", content: "two" },
];

const renderEditor = (onChange: (s: SnippetStep[]) => void) =>
  render(<StepListEditor value={steps} onChange={onChange} snippets={[]} onBrowseRemote={() => {}} />);

test("dragging the first step after the second swaps them", () => {
  const onChange = vi.fn();
  renderEditor(onChange);
  const handles = screen.getAllByLabelText("snippets.step.dragToReorder");
  fireEvent.mouseDown(handles[0]);
  fireEvent.mouseMove(handles[1].closest("[class*='rounded-lg']")!, { clientY: 10 });
  fireEvent.mouseUp(handles[0]);
  expect(onChange).toHaveBeenCalledWith([steps[1], steps[0]]);
});

test("remove drops the step", () => {
  const onChange = vi.fn();
  renderEditor(onChange);
  fireEvent.click(screen.getAllByLabelText("snippets.step.remove")[0]);
  expect(onChange).toHaveBeenCalledWith([steps[1]]);
});
