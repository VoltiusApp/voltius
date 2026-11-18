import { createSerialQueue } from "@/lib/serialQueue";

// `state_import` rewrites whole files: every read-merge-write of local state runs here, one at a time.
export const serialMerge = createSerialQueue();
