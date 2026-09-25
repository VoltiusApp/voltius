import { describe, it, expect, afterEach } from "vitest";
import i18n from "@/i18n";
import en from "@/i18n/locales/en/errors.json";
import {
  BACKEND_ERROR_CODES,
  BackendError,
  backendErrorCode,
  describeError,
  fromInvokeRejection,
  type BackendErrorCode,
} from "./backendErrors";
import { VaultLockedError } from "./vaultErrors";

afterEach(() => i18n.changeLanguage("en"));

describe("describeError", () => {
  it("translates a coded error, filling its params", async () => {
    const err = new BackendError("port-in-use", "Port 8080 already in use after 5 attempts", { port: "8080", attempts: "5" });
    expect(describeError(err, i18n.t)).toBe("Port 8080 and the ports after it are already in use (5 tried)");
    await i18n.changeLanguage("fr");
    expect(describeError(err, i18n.t)).toBe("Le port 8080 et les suivants sont déjà utilisés (5 essayés)");
  });

  it("falls back to the backend's message for a code this build cannot name", () => {
    const err = new BackendError("from-a-newer-backend" as BackendErrorCode, "Something new");
    expect(describeError(err, i18n.t)).toBe("Something new");
  });

  it("passes uncoded errors through", () => {
    expect(describeError("Transfer cancelled", i18n.t)).toBe("Transfer cancelled");
    expect(describeError(new Error("boom"), i18n.t)).toBe("boom");
  });

  it("names the vault the way the frontend's own vault errors do", async () => {
    await i18n.changeLanguage("tr");
    const fromRust = fromInvokeRejection({ code: "vault-locked", message: "Secrets store is locked" });
    expect(describeError(fromRust, i18n.t)).toBe(new VaultLockedError().message);
  });
});

describe("fromInvokeRejection", () => {
  it("builds a BackendError from the wire shape, leaving strings alone", () => {
    const err = fromInvokeRejection({ code: "not-found", message: "remove_file failed: No such file" });
    expect(backendErrorCode(err)).toBe("not-found");
    expect(String(err)).toBe("remove_file failed: No such file");
    expect(fromInvokeRejection("plain")).toBe("plain");
    expect(backendErrorCode("plain")).toBeNull();
  });
});

// Rust's `every_code_has_an_english_translation` ties ErrorCode to the same file.
describe("errors.json", () => {
  it("has exactly one English string per backend code", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...BACKEND_ERROR_CODES].sort());
  });
});
