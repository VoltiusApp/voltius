import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { FindBar, type FindOption } from "@/components/shared/FindBar";

const MAX_COUNTED = 9999;

type QuerySpec = ConstructorParameters<typeof SearchQuery>[0];

function specOf(q: SearchQuery): QuerySpec {
  return { search: q.search, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord, replace: q.replace, literal: q.literal };
}

const OPTION_FIELD: Record<FindOption, "caseSensitive" | "wholeWord" | "regexp"> = {
  caseSensitive: "caseSensitive",
  wholeWord: "wholeWord",
  regex: "regexp",
};

export function countMatches(state: EditorState, q: SearchQuery): { index: number; count: number } {
  if (!q.valid) return { index: -1, count: 0 };
  const sel = state.selection.main;
  const cursor = q.getCursor(state);
  let count = 0;
  let index = -1;
  for (let m = cursor.next(); !m.done && count < MAX_COUNTED; m = cursor.next()) {
    if (m.value.from === sel.from && m.value.to === sel.to) index = count;
    count += 1;
  }
  return { index, count };
}

/** Applies a query and, when its text changed, selects the first match at or after the cursor. */
function applyQuery(view: EditorView, next: SearchQuery, reveal: boolean) {
  let selection: { anchor: number; head: number } | undefined;
  if (reveal && next.valid) {
    const from = view.state.selection.main.from;
    let m = next.getCursor(view.state, from).next();
    if (m.done) m = next.getCursor(view.state, 0, from).next();
    if (!m.done) selection = { anchor: m.value.from, head: m.value.to };
  }
  view.dispatch({ effects: setSearchQuery.of(next), selection, scrollIntoView: !!selection, userEvent: "select.search" });
}

function EditorFind({ view, panel }: { view: EditorView; panel: FindPanel }) {
  useSyncExternalStore(panel.subscribe, panel.version);
  const query = getSearchQuery(view.state);
  const { index, count } = countMatches(view.state, query);
  const patch = (change: Partial<QuerySpec>, reveal = false) =>
    applyQuery(view, new SearchQuery({ ...specOf(query), ...change }), reveal);
  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };

  return (
    <FindBar
      query={query.search}
      onQueryChange={(search) => patch({ search }, true)}
      caseSensitive={query.caseSensitive}
      wholeWord={query.wholeWord}
      regex={query.regexp}
      onToggle={(option) => {
        const field = OPTION_FIELD[option];
        const change: Partial<QuerySpec> = {};
        change[field] = !query[field];
        patch(change, true);
      }}
      resultIndex={index}
      resultCount={count}
      invalidRegex={query.regexp && !!query.search && !query.valid}
      onNext={() => findNext(view)}
      onPrev={() => findPrevious(view)}
      onClose={close}
      focusTick={0}
      replace={view.state.readOnly ? undefined : {
        value: query.replace,
        onChange: (replace) => patch({ replace }),
        onReplace: () => replaceNext(view),
        onReplaceAll: () => replaceAll(view),
      }}
      onOtherKey={(e) => runScopeHandlers(view, e, "search-panel")}
      inputAttributes={{ "main-field": "true" }}
    />
  );
}

class FindPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly root: Root;
  private readonly listeners = new Set<() => void>();
  private tick = 0;

  constructor(view: EditorView) {
    this.dom.className = "cm-voltius-find";
    this.root = createRoot(this.dom);
    this.root.render(<EditorFind view={view} panel={this} />);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  version = () => this.tick;

  update(update: ViewUpdate) {
    const queryChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));
    if (!update.docChanged && !update.selectionSet && !queryChanged) return;
    this.tick += 1;
    for (const fn of this.listeners) fn();
  }

  destroy() {
    const root = this.root;
    // React refuses a synchronous unmount while it is rendering, which a CodeMirror update can be inside.
    queueMicrotask(() => root.unmount());
  }
}

export const cmFind = search({ top: true, createPanel: (view) => new FindPanel(view) });
