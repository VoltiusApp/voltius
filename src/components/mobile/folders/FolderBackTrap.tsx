import { useBackInterceptor } from "@/hooks/useBackInterceptor";

/** Render one per folder-path level so each hardware-back press pops one level (LIFO via useBackInterceptor). */
export default function FolderBackTrap({ onBack }: { onBack: () => void }) {
  useBackInterceptor(true, onBack);
  return null;
}
