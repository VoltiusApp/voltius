import { useBackInterceptor } from "@/hooks/useBackInterceptor";

/** Render one per folder-path level so N levels reserve N hardware-back presses,
 *  each popping one level (LIFO via useBackInterceptor). */
export default function FolderBackTrap({ onBack }: { onBack: () => void }) {
  useBackInterceptor(true, onBack);
  return null;
}
