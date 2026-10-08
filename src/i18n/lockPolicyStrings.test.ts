// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import i18n from "./index";

const key = "settings.account.sessionSecurity.policy.timeout";
const label = (k: string) => i18n.t(`settings.account.sessionSecurity.timeout.${k}`);

afterEach(async () => { await i18n.changeLanguage("en"); });

test("several teams read as one source, not a subject that needs agreement", () => {
  expect(i18n.t(key, { teams: "Acme, Ops", duration: label("15min") })).toBe("Set by Acme, Ops: at most 15 minutes.");
});

test("Czech keeps the duration label in the form the label already has", async () => {
  await i18n.changeLanguage("cs");
  expect(i18n.t(key, { teams: "Acme", duration: label("1h") })).toBe("Určuje Acme: nejvýše 1 hodina.");
});
