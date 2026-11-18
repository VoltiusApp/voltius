import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { useAutosave } from "./useAutosave";

afterEach(() => { cleanup(); vi.useRealTimers(); });

let setValue: (v: string) => void = () => {};
let lastBlocked = false;

function Harness({ onSave, flushOnUnmount }: { onSave: (v: string) => void; flushOnUnmount?: boolean }) {
  const [value, set] = useState("start");
  const { schedule, markDirty, blocked } = useAutosave({
    onSave: () => onSave(value),
    canSave: () => value.trim().length > 0,
    flushOnUnmount,
  });
  setValue = (v) => { markDirty(); set(v); };
  lastBlocked = blocked;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [value]);
  return null;
}

describe("useAutosave", () => {
  test("blocked while an edit can't be saved, cleared once it can", () => {
    vi.useFakeTimers();
    render(<Harness onSave={() => {}} />);
    expect(lastBlocked).toBe(false);
    act(() => setValue(""));
    expect(lastBlocked).toBe(true);
    act(() => setValue("ok"));
    expect(lastBlocked).toBe(false);
  });

  test("flushOnUnmount saves the edit still waiting on the debounce", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { unmount } = render(<Harness onSave={onSave} flushOnUnmount />);
    act(() => setValue("typed"));
    unmount();
    expect(onSave).toHaveBeenCalledWith("typed");
  });

  test("without it an unmount drops the pending edit (desktop closes through flushAndClose)", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { unmount } = render(<Harness onSave={onSave} />);
    act(() => setValue("typed"));
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("flushOnUnmount never saves an edit that can't be saved, nor twice", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { unmount } = render(<Harness onSave={onSave} flushOnUnmount />);
    act(() => setValue("saved"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => setValue(""));
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("waits for a text field to lose focus before saving", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<><Harness onSave={onSave} /><input data-testid="field" /><button>other</button></>);
    const field = document.querySelector("input") as HTMLInputElement;
    field.focus();
    act(() => setValue("typed"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSave).not.toHaveBeenCalled();
    act(() => { field.blur(); vi.advanceTimersByTime(10); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("typed");
  });

  test("saves on the debounce when no text field has focus", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    act(() => setValue("toggled"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSave).toHaveBeenCalledWith("toggled");
  });
});
