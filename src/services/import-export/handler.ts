import type { ExportBundle } from "./formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "./context";

// ─── DataTypeHandler ──────────────────────────────────────────────────────────
// One implementation per data type (connections, identities, keys, snippets,
// port forwarding rules). Register in registry.ts. Adding a new type = new file
// + one entry in HANDLERS. The modal never imports individual stores.

export interface DataTypeHandler {
  // Identifies the ExportBundle field this handler populates.
  readonly key: string;
  // Human-readable label for the checkbox.
  readonly label: string;
  // When true, the checkbox is disabled and unchecked in CSV mode.
  readonly jsonOnly: boolean;

  // ── Export ────────────────────────────────────────────────────────────────

  // Whether this handler's checkbox is visible + checked by default.
  // Returning false hides the checkbox entirely (e.g. snippets in single-item mode).
  isActive(selection: SelectionProps): boolean;

  // Text shown on the checkbox, including live item count.
  checkboxLabel(selection: SelectionProps, count: number): string;

  // Number of exportable items for the given vaults (drives the checkbox count).
  countAvailable(stores: StoreSlices, vaultIds: string[]): number;

  // Return the items that should be exported given vault filter + selection props.
  selectItems(stores: StoreSlices, vaultIds: string[], selection: SelectionProps): unknown[];

  // Report which folder IDs are referenced so the orchestrator can build eid maps.
  // Handlers that use main folders write into `main`; snippets write into `snippet`.
  accumulateFolderIds(items: unknown[], main: Set<string>, snippet: Set<string>): void;

  // Write export records into bundle[key]. May also populate ctx eid maps
  // so later handlers can cross-reference (e.g. connections populate connectionEidMap).
  buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle): Promise<void>;

  // ── Import ────────────────────────────────────────────────────────────────

  // Read from bundle[key], create items via ctx.stores, update ctx eid maps.
  // Returns { imported, errors }.
  importItems(bundle: ExportBundle, ctx: ImportCtx): Promise<{ imported: number; errors: number }>;

  // Refresh Zustand store state after a successful import.
  reload(reloaders: ReloadFns): Promise<void>;
}
