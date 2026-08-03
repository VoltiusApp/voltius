import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberedVars, rememberVars, clearRememberedVars, useHostCommandVarsStore,
} from "./hostCommandVarsStore";
import type { ParsedVariable } from "@/services/snippetParser";

const textVar = (name: string): ParsedVariable => ({ name, type: "text", dynamic: false });
const pwVar = (name: string): ParsedVariable => ({ name, type: "password", dynamic: false });

beforeEach(() => useHostCommandVarsStore.setState({ values: {} }));

describe("host command variable memory", () => {
  it("returns an empty object when nothing is stored", () => {
    expect(rememberedVars("c1", "s1")).toEqual({});
  });

  it("round-trips remembered values per connection and snippet", () => {
    rememberVars("c1", "s1", { env: "prod" }, [textVar("env")]);
    expect(rememberedVars("c1", "s1")).toEqual({ env: "prod" });
    expect(rememberedVars("c2", "s1")).toEqual({});
    expect(rememberedVars("c1", "s2")).toEqual({});
  });

  it("never stores password-typed variables", () => {
    rememberVars("c1", "s1", { env: "prod", token: "hunter2" }, [textVar("env"), pwVar("token")]);
    expect(rememberedVars("c1", "s1")).toEqual({ env: "prod" });
  });

  it("drops a key entirely when every variable is a password", () => {
    rememberVars("c1", "s1", { token: "hunter2" }, [pwVar("token")]);
    expect(useHostCommandVarsStore.getState().values).toEqual({});
  });

  it("clears every snippet's values for one connection only", () => {
    rememberVars("c1", "s1", { env: "prod" }, [textVar("env")]);
    rememberVars("c1", "s2", { region: "eu" }, [textVar("region")]);
    rememberVars("c2", "s1", { env: "dev" }, [textVar("env")]);

    clearRememberedVars("c1");

    expect(rememberedVars("c1", "s1")).toEqual({});
    expect(rememberedVars("c1", "s2")).toEqual({});
    expect(rememberedVars("c2", "s1")).toEqual({ env: "dev" });
  });
});
