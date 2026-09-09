"use client";

import { useTheme } from "@/hooks/useTheme";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: string; hint: string }> = [
  { value: "light", label: "Light", icon: "☀️", hint: "Light theme" },
  { value: "system", label: "Auto", icon: "🌓", hint: "Follow system preference" },
  { value: "dark", label: "Dark", icon: "🌙", hint: "Dark theme" },
];

/**
 * Light / Auto / Dark segmented control. The default is "system" (follow the
 * OS), with explicit choices persisted to localStorage by useTheme.
 */
export default function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = preference === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPreference(opt.value)}
            aria-label={opt.hint}
            aria-pressed={active}
            title={opt.hint}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all ${
              active
                ? "bg-gradient-to-br from-stellar-blue to-stellar-purple shadow"
                : "opacity-40 hover:opacity-80"
            }`}
          >
            <span aria-hidden>{opt.icon}</span>
            <span className="sr-only">
              {opt.label} theme {opt.value === "system" ? `(currently ${resolved})` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
