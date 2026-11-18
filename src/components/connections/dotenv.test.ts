import { test, expect } from "vitest";
import { parseDotenv, serializeDotenv, withStableIds, mergeEnvVars } from "./dotenv";

test("parses comments, export prefixes, quotes and inline comments", () => {
  const text = [
    "# database",
    "export DB_HOST=db.internal",
    "",
    "PORT = 5432   # default",
    "NAME='single # kept'",
    'GREETING="hello\\nworld \\"quoted\\""',
    "TOKEN=abc#def",
    "EMPTY=",
  ].join("\r\n");
  expect(parseDotenv(text)).toEqual({
    vars: [
      { key: "DB_HOST", value: "db.internal" },
      { key: "PORT", value: "5432" },
      { key: "NAME", value: "single # kept" },
      { key: "GREETING", value: 'hello\nworld "quoted"' },
      { key: "TOKEN", value: "abc#def" },
      { key: "EMPTY", value: "" },
    ],
    skipped: [],
  });
});

test("reads multi-line quoted values", () => {
  expect(parseDotenv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1').vars).toEqual([
    { key: "KEY", value: "-----BEGIN-----\nabc\n-----END-----" },
    { key: "NEXT", value: "1" },
  ]);
});

test("skips invalid lines and keeps the last duplicate", () => {
  const { vars, skipped } = parseDotenv("1BAD=x\nno equals here\nA=1\nA=2\nUNCLOSED=\"oops\nB=3");
  expect(vars).toEqual([{ key: "A", value: "2" }, { key: "B", value: "3" }]);
  expect(skipped).toEqual(["1BAD=x", "no equals here", 'UNCLOSED="oops']);
});

test("serialize round-trips through parse", () => {
  const vars = [
    { key: "PLAIN", value: "abc=def" },
    { key: "SPACED", value: " lead and trail " },
    { key: "MULTI", value: 'line1\nline2\t"q" \\ #' },
    { key: "EMPTY", value: "" },
  ];
  const text = serializeDotenv([...vars, { key: "", value: "dropped" }]);
  expect(text.split("\n")[0]).toBe("PLAIN=abc=def");
  expect(parseDotenv(text)).toEqual({ vars, skipped: [] });
});

test("withStableIds keeps ids of existing keys", () => {
  const out = withStableIds([{ key: "A", value: "new" }, { key: "B", value: "b" }], [{ id: "a1", key: "A", value: "old" }]);
  expect(out[0]).toEqual({ id: "a1", key: "A", value: "new" });
  expect(out[1].id).not.toBe("a1");
});

test("mergeEnvVars updates existing keys in place and inserts new ones at the pasted row", () => {
  const list = [
    { id: "1", key: "A", value: "a" },
    { id: "2", key: "", value: "" },
    { id: "3", key: "C", value: "c" },
  ];
  const out = mergeEnvVars(list, [{ key: "C", value: "c2" }, { key: "D", value: "d" }, { key: "E", value: "e" }], "2");
  expect(out.map((e) => [e.key, e.value])).toEqual([["A", "a"], ["D", "d"], ["E", "e"], ["C", "c2"]]);
  expect(out[3].id).toBe("3");
});
