import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChipInput } from "./ChipInput";

vi.mock("@iconify/react", () => ({ Icon: () => null }));

afterEach(cleanup);

function Harness({ initial = [] as string[], onEscape }: { initial?: string[]; onEscape?: () => void }) {
  const [value, setValue] = useState(initial);
  const [input, setInput] = useState("");
  return (
    <ChipInput
      value={value}
      input={input}
      onInputChange={setInput}
      onAdd={(text) => {
        setValue([...value, text]);
        setInput("");
      }}
      onRemove={(item) => setValue(value.filter((v) => v !== item))}
      renderChip={(item, children) => <span key={item} data-testid="chip">{children}</span>}
      removeLabel={(item) => `remove ${item}`}
      placeholder="add one"
      ariaLabel="words"
      onEscape={onEscape}
    />
  );
}

const chips = () => screen.queryAllByTestId("chip").map((chip) => chip.textContent);
const box = () => screen.getByLabelText("words") as HTMLInputElement;

describe("ChipInput", () => {
  it("adds the trimmed text on Enter and clears the input", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "  error " } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chips()).toEqual(["error"]);
    expect(box().value).toBe("");
  });

  it("adds on a typed comma", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "warn," } });
    expect(chips()).toEqual(["warn"]);
  });

  it("adds nothing for blank text", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "   " } });
    fireEvent.keyDown(box(), { key: "Enter" });
    fireEvent.change(box(), { target: { value: "," } });
    expect(chips()).toEqual([]);
  });

  it("removes the last chip on Backspace in an empty input", () => {
    render(<Harness initial={["a", "b"]} />);
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(chips()).toEqual(["a"]);
  });

  it("keeps the chips on Backspace while there is text", () => {
    render(<Harness initial={["a"]} />);
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(chips()).toEqual(["a"]);
  });

  it("removes a chip from its button", () => {
    render(<Harness initial={["a", "b"]} />);
    fireEvent.click(screen.getByLabelText("remove a"));
    expect(chips()).toEqual(["b"]);
  });

  it("reports Escape", () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("shows the placeholder only while there are no chips", () => {
    render(<Harness />);
    expect(box().placeholder).toBe("add one");
    fireEvent.change(box(), { target: { value: "a," } });
    expect(box().placeholder).toBe("");
  });
});
