/**
 * Associates a transfer_file call's queue-row id with the exact `args` object
 * that call is running with. NOT a module-level variable: two MCP transfers
 * can overlap (nothing serialises tool calls), and a plain variable would let
 * the second call's id clobber the first's before it dispatches, crossing
 * their progress streams. Each call to `callTool` produces its own `args`
 * object via zod's `safeParse`, and that same reference flows unchanged
 * through `queueTransfer` → `fileOp` → the tool's `execute`, so keying on it
 * scopes the id to exactly one call. The WeakMap lets the entry be collected
 * once the call finishes without an explicit cleanup step.
 */
const transferIds = new WeakMap<object, string>();

export function setTransferId(args: object, id: string): void {
  transferIds.set(args, id);
}

export function takeTransferId(args: object): string | undefined {
  const id = transferIds.get(args);
  transferIds.delete(args);
  return id;
}
