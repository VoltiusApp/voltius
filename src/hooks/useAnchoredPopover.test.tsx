import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useAnchoredPopover } from "./useAnchoredPopover";

afterEach(cleanup);

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popover = useAnchoredPopover(open, onClose, anchorRef);
  return (
    <>
      <button ref={anchorRef}>anchor</button>
      <span>outside</span>
      {popover.mounted && <div ref={popover.panelRef}>panel</div>}
    </>
  );
}

test("a press on the anchor leaves closing to the anchor's own toggle", () => {
  const onClose = vi.fn();
  const { getByText } = render(<Harness open onClose={onClose} />);
  fireEvent.mouseDown(getByText("anchor"));
  fireEvent.mouseDown(getByText("panel"));
  expect(onClose).not.toHaveBeenCalled();
});

test("a press outside or Escape closes it", () => {
  const onClose = vi.fn();
  const { getByText } = render(<Harness open onClose={onClose} />);
  fireEvent.mouseDown(getByText("outside"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("does nothing while closed", () => {
  const onClose = vi.fn();
  const { getByText } = render(<Harness open={false} onClose={onClose} />);
  fireEvent.mouseDown(getByText("outside"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

test("a press inside a submenu portal does not close it", () => {
  const onClose = vi.fn();
  render(<Harness open onClose={onClose} />);
  const portal = document.createElement("div");
  portal.setAttribute("data-menu-portal", "");
  portal.innerHTML = "<button>sub</button>";
  document.body.appendChild(portal);
  fireEvent.mouseDown(portal.querySelector("button")!);
  expect(onClose).not.toHaveBeenCalled();
  portal.remove();
});

test("Escape is claimed before listeners behind the popover see it", () => {
  const onClose = vi.fn();
  const behind = vi.fn();
  document.addEventListener("keydown", behind);
  render(<Harness open onClose={onClose} />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(behind).not.toHaveBeenCalled();
  document.removeEventListener("keydown", behind);
});

test("a text field inside the popover keeps its own Escape", () => {
  const onClose = vi.fn();
  function WithField() {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const popover = useAnchoredPopover(true, onClose, anchorRef);
    return (
      <>
        <button ref={anchorRef}>anchor</button>
        <div ref={popover.panelRef}><input aria-label="field" /></div>
      </>
    );
  }
  const { getByLabelText } = render(<WithField />);
  fireEvent.keyDown(getByLabelText("field"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});
