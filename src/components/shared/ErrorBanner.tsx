import { Icon } from "@iconify/react";

interface Props {
  error: string;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  return (
    <div
      className="mx-5 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs bg-[#2D1515] border border-[#5C2020] text-[#F87171]"
    >
      <Icon icon="lucide:alert-circle" width={14} />
      <span className="flex-1">{error}</span>
      <button className="underline opacity-70 hover:opacity-100 transition-opacity" onClick={onDismiss}>
        dismiss
      </button>
    </div>
  );
}
