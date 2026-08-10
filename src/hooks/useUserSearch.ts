import { useEffect, useRef, useState } from "react";
import { searchUsers } from "@/services/teamService";

export interface UserSearchResult { user_id: string; display_name: string; public_key: string; }

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/**
 * Debounced directory search with the dropdown open state and the
 * click-outside dismissal shared by every invite surface.
 */
export function useUserSearch(excludeIds?: Set<string>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Keyed by content, not identity: an unmemoized Set from the caller would
  // otherwise re-run the search on every render.
  const excludeKey = excludeIds ? [...excludeIds].sort().join(",") : "";
  const excludeRef = useRef(excludeIds);
  excludeRef.current = excludeIds;

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) { setResults([]); setOpen(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(query)
        .then((r) => {
          const exclude = excludeRef.current;
          setResults(exclude ? r.filter((u) => !exclude.has(u.user_id)) : r);
          setOpen(true);
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, excludeKey]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!inputRef.current?.contains(e.target as Node) && !dropdownRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const reset = () => { setQuery(""); setResults([]); setOpen(false); };

  return { query, setQuery, results, searching, open, setOpen, inputRef, dropdownRef, reset };
}
