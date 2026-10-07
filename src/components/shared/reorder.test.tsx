import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { useListReorder } from "@/hooks/useListReorder";
import { ReorderableRow } from "./reorder";

afterEach(cleanup);

const onOrder = vi.fn();

function Harness() {
  const [items, setItems] = useState([{ id: "x" }, { id: "y" }]);
  const dnd = useListReorder(items, (next) => { setItems(next); onOrder(next.map((i) => i.id)); });
  return (
    <div {...dnd.containerProps}>
      {items.map((it, i) => (
        <ReorderableRow
          key={it.id}
          dnd={dnd}
          id={it.id}
          index={i}
          onRemove={() => onOrder(`remove-${it.id}`)}
          removeLabel={`remove-${it.id}`}
          dragLabel={`drag-${it.id}`}
        >
          <span>{`row-${it.id}`}</span>
        </ReorderableRow>
      ))}
    </div>
  );
}

test("badges number the rows", () => {
  render(<Harness />);
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
});

test("dragging x after y swaps them", () => {
  onOrder.mockClear();
  render(<Harness />);
  fireEvent.mouseDown(screen.getByLabelText("drag-x"));
  fireEvent.mouseMove(screen.getByText("row-y").parentElement!, { clientY: 10 });
  fireEvent.mouseUp(screen.getByLabelText("drag-x"));
  expect(onOrder).toHaveBeenCalledWith(["y", "x"]);
});

test("mouse-down on remove does not start a drag", () => {
  onOrder.mockClear();
  render(<Harness />);
  fireEvent.mouseDown(screen.getByLabelText("remove-x"));
  fireEvent.mouseMove(screen.getByText("row-y").parentElement!, { clientY: 10 });
  fireEvent.mouseUp(screen.getByLabelText("remove-x"));
  expect(onOrder).not.toHaveBeenCalled();
});

test("remove calls onRemove", () => {
  onOrder.mockClear();
  render(<Harness />);
  fireEvent.click(screen.getByLabelText("remove-y"));
  expect(onOrder).toHaveBeenCalledWith("remove-y");
});
