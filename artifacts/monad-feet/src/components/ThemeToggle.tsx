import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemePreference } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn("inline-flex items-center gap-0.5 rounded-full border border-border bg-card/80 p-0.5 backdrop-blur", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            data-testid={`button-theme-${value}`}
            onClick={() => setTheme(value)}
            className={cn(
              "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
