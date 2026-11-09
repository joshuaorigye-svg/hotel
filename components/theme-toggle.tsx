"use client";

import { Moon, Sun } from "lucide-react";
import { useWorkspaceTheme } from "@/components/theme-provider";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useWorkspaceTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-surface)] px-3 py-2 text-sm font-medium text-[var(--workspace-text)] shadow-sm transition hover:opacity-80 ${compact ? "h-10 w-10 px-0" : ""}`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      {!compact && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}
