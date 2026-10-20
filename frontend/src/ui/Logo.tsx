import { cn } from "../lib/cn";
import { StationIcon } from "./StationIcon";

/**
 * The logo (#444): the factory station beside the name in the display face. The favicon and the app
 * icons are the same mark (src/ui/logoMark.ts). The name stays "Satis Manager" in the text, set in
 * capitals by CSS, so screen readers say it as words. The icon is decorative: the name names it.
 */
export function Logo({ size = "header", className }: { size?: "header" | "hero"; className?: string }) {
  const hero = size === "hero";
  return (
    <span
      className={cn(
        "inline-flex items-center font-display leading-none font-bold tracking-wide text-fg-strong uppercase",
        hero ? "gap-4 text-4xl sm:text-5xl" : "gap-2.5 text-2xl",
        className,
      )}
    >
      <StationIcon kind="factory" size={hero ? 64 : 32} />
      Satis Manager
    </span>
  );
}
