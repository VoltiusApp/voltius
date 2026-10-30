import { expect, test } from "vitest";
import { assembleLocales } from "./bundles";

const bundles = assembleLocales(
  import.meta.glob("./locales/*/*.json", { eager: true }) as Record<string, { default: Record<string, unknown> }>,
);

const at = (bundle: Record<string, unknown>, path: string) =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], bundle);

const LEAVE_IN_BOTH_GROUPED: Record<string, string> = {
  cs: "opusťte skupinu",
  en: "Leave the group",
  fr: "Quittez le groupe",
  pt: "Saia do grupo",
  "pt-PT": "Saia do grupo",
  ru: "Покиньте группу",
  tr: "gruptan ayrılın",
  zh: "退出该组",
};

test.each(Object.entries(LEAVE_IN_BOTH_GROUPED))("%s: both-grouped refusal points at Leave, not at Forget", (locale, leave) => {
  const copy = at(bundles[locale], "errors.pair.ended.bothGrouped");
  expect(copy).toContain(leave);
  expect(copy).not.toContain(at(bundles[locale], "layout.sync.local.forget.label") as string);
});
