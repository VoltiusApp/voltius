import { test, expect } from "vitest";
import { TOGGLE_DEFS, type ToggleId } from "./toggleDefs";

const sections = import.meta.glob("/src/components/settings/sections/*Section.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const sectionOf = (file: string) => file.match(/\/(\w+)Section\.tsx$/)![1].toLowerCase();

test("every toggle declares the settings section that actually renders it", () => {
  expect(Object.keys(sections).length).toBeGreaterThan(0);
  for (const id of Object.keys(TOGGLE_DEFS) as ToggleId[]) {
    const renderedIn = Object.entries(sections)
      .filter(([, text]) => text.includes(`useToggle("${id}")`))
      .map(([file]) => sectionOf(file));
    for (const section of renderedIn) {
      expect(section, id).toBe(TOGGLE_DEFS[id].section.toLowerCase());
    }
  }
});
