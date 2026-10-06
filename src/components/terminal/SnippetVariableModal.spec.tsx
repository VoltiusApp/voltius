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
  return { onInject, trigger: screen.getByRole("button", { name: "environment" }) };
}

afterEach(cleanup);

describe("SnippetVariableModal choice variables", () => {
  it("offers every option with the first one pre-selected", () => {
    const { trigger } = renderModal();
    expect(trigger.textContent).toBe("development");
    fireEvent.click(trigger);
    for (const option of ["development", "staging", "production"]) {
      expect(screen.getAllByText(option).length).toBeGreaterThan(0);
    }
  });

  it("substitutes the picked option", () => {
    const { onInject, trigger } = renderModal();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("staging"));
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenCalledWith("echo staging", true);
  });
});
