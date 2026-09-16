import { test, expect, beforeAll } from "vitest";
import { recordHostIconPrefix } from "@/utils/hostIconPrefixes";
import { catalogIcon } from "./catalogIcon";

beforeAll(() => {
  recordHostIconPrefix("simple-icons");
  recordHostIconPrefix("lucide");
});

test("keeps an icon whose prefix the host bundles", () => {
  expect(catalogIcon("simple-icons:cloudflare", "lucide:puzzle")).toBe("simple-icons:cloudflare");
});

test("falls back for a prefix the host does not bundle, so Iconify never fetches it", () => {
  expect(catalogIcon("mdi:cloud", "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon("https://evil.example/x.svg", "lucide:puzzle")).toBe("lucide:puzzle");
});

test("falls back for a missing or malformed name", () => {
  expect(catalogIcon(undefined, "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon("", "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon("lucide", "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon("lucide:", "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon(":puzzle", "lucide:puzzle")).toBe("lucide:puzzle");
  expect(catalogIcon(42 as unknown as string, "lucide:puzzle")).toBe("lucide:puzzle");
});
