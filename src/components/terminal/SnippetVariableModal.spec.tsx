import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { SnippetVariableModal } from "./SnippetVariableModal";
import { parseVariables, buildDefaultValues } from "@/services/snippetParser";

const template = "echo {{environment:choice:development,staging,production}}";
const userVars = parseVariables(template);

function renderModal(onInject = vi.fn()) {
  render(
    <SnippetVariableModal
      snippetName="deploy"
      partialTemplate={template}
      userVars={userVars}
      initialValues={buildDefaultValues(userVars)}
      onInject={onInject}
      onClose={vi.fn()}
    />,
  );
  return { onInject, select: screen.getByRole("combobox") as HTMLSelectElement };
}

afterEach(cleanup);

describe("SnippetVariableModal choice variables", () => {
  it("offers every option with the first one pre-selected", () => {
    const { select } = renderModal();
    expect([...select.options].map((o) => o.value)).toEqual([
      "development", "staging", "production",
    ]);
    expect(select.value).toBe("development");
  });

  it("substitutes the picked option", () => {
    const { onInject, select } = renderModal();
    fireEvent.change(select, { target: { value: "staging" } });
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenCalledWith("echo staging", true);
  });
});
