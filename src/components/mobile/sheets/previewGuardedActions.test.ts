import { test, expect, vi, afterEach } from "vitest";
import { previewGuarded } from "./previewGuardedActions";
import { startPreview, stopPreview, explainable } from "@/test/preview";
import { usePreviewStore } from "@/stores/previewStore";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

afterEach(stopPreview);

const action = (over: Record<string, unknown> = {}) => ({ icon: "i", label: "l", onTap: vi.fn(), ...over });

test("guarded_actions_refuse_and_reads_pass_through", () => {
  const write = action();
  const read = action({ reads: true });
  const disabled = action({ disabled: true });
  const reasoned = action({ disabledReason: "why" });
  const close = vi.fn();
  const [w, r, d, dr] = previewGuarded([write, read, disabled, reasoned], { type: "connection", objectId: "c1" }, close);
  expect(r).toBe(read);
  expect(d).toBe(disabled);
  expect(dr).toBe(reasoned);

  startPreview();
  explainable("c1");
  w.onTap();
  r.onTap();
  expect(write.onTap).not.toHaveBeenCalled();
  expect(read.onTap).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "connection", objectId: "c1" });
});

test("outside_a_preview_a_guarded_action_runs", () => {
  const write = action();
  const close = vi.fn();
  previewGuarded([write], undefined, close)[0].onTap();
  expect(write.onTap).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});
