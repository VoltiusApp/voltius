import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminDefaultsState {
  applied: Record<string, true>;
  touched: Record<string, true>;
  markApplied: (key: string) => void;
  clear: (key: string) => void;
}

export const useAdminDefaultsStore = create<AdminDefaultsState>()(
  persist(
    (set) => ({
      applied: {},
      touched: {},
      markApplied: (key) => set((s) => ({ applied: { ...s.applied, [key]: true } })),
      clear: (key) =>
        set((s) => {
          const { [key]: _, ...rest } = s.applied;
          return { applied: rest, touched: s.touched[key] ? s.touched : { ...s.touched, [key]: true } };
        }),
    }),
    { name: "voltius-admin-defaults" },
  ),
);

export const isAdminDefaulted = (key: string): boolean => !!useAdminDefaultsStore.getState().applied[key];
