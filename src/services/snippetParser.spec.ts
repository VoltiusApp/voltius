import { describe, it, expect } from "vitest";
import { parseVariables, needsUserInput, buildDefaultValues } from "./snippetParser";

describe("snippetParser choice variables", () => {
  const [choiceVar] = parseVariables("echo {{environment:choice:development,staging,production}}");

  it("parses the option list and defaults to the first option", () => {
    expect(choiceVar.type).toBe("choice");
    expect(choiceVar.choices).toEqual(["development", "staging", "production"]);
    expect(choiceVar.default).toBe("development");
  });

  it("prompts even though the first option pre-fills the picker", () => {
    expect(needsUserInput(choiceVar)).toBe(true);
    expect(buildDefaultValues([choiceVar])).toEqual({ environment: "development" });
  });

  it("still prompts when no options are declared", () => {
    const [v] = parseVariables("echo {{environment:choice}}");
    expect(needsUserInput(v)).toBe(true);
  });

  it("leaves other typed variables with a default resolved", () => {
    const vars = parseVariables("echo {{port:number:22}} {{flag:boolean:true}} {{name:text:web}}");
    expect(vars.map(needsUserInput)).toEqual([false, false, false]);
  });
});
