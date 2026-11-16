import { isMobileShell } from "@/utils/platform";

export const touchSize = (): "touch" | "sm" => (isMobileShell() ? "touch" : "sm");

export const touchHeight = (): string => (isMobileShell() ? "min-h-12" : "");
