import { lazyNamed } from "@/utils/lazyNamed";

export const LazyNotesEditor = lazyNamed(() => import("./NotesEditor"), "NotesEditor");
