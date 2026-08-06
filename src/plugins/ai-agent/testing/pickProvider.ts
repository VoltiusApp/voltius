import { fireEvent } from "@testing-library/react";

/**
 * Drive the provider `FormSelect`, which is a button + portal menu rather than
 * a native `<select>`, so `fireEvent.change` has nothing to change.
 *
 * `label` is the provider's literal display text (never translated), which is
 * why this works under both the key-echo and the catalog fake i18n. `index`
 * picks between several rendered forms.
 */
export function pickProvider(label: string, index = 0): void {
  const triggers = document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]');
  fireEvent.click(triggers[index]);
  const items = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);
  fireEvent.click(items[items.length - 1]);
}
