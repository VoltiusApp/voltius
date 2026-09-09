import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useContextMenu } from "./ContextMenu";

afterEach(cleanup);

function Probe() {
  const { pos, openAt } = useContextMenu();
  return (
    <div>
      <button onClick={() => openAt({ left: 40, bottom: 96 })}>trigger</button>
      <span data-testid="pos">{pos ? `${pos.x},${pos.y}` : "closed"}</span>
    </div>
  );
}

test("openAt anchors the menu to the trigger's bottom-left, not the pointer", () => {
  render(<Probe />);
  expect(screen.getByTestId("pos").textContent).toBe("closed");
  fireEvent.click(screen.getByText("trigger"));
  expect(screen.getByTestId("pos").textContent).toBe("40,100");
});
