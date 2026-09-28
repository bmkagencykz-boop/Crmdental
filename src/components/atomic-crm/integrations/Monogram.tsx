import { cn } from "@/lib/utils";

import type { CatalogLogo, MonogramTone } from "./catalogModel";

const TONES: Record<MonogramTone, string> = {
  primary: "bg-primary text-primary-foreground",
  rose: "bg-brand-rose/20 text-brand-link",
  blush: "bg-brand-blush/35 text-foreground",
  neutral: "bg-muted text-foreground",
  outline: "border bg-card text-foreground",
  ink: "bg-foreground text-background",
};

/** Logo of an integration: its letters on a tile (no generic icons) */
export const Monogram = ({
  logo,
  size = "md",
  className,
}: {
  logo: CatalogLogo;
  size?: "md" | "lg";
  className?: string;
}) => (
  <span
    aria-hidden
    className={cn(
      "flex shrink-0 select-none items-center justify-center rounded-md font-bold tracking-[-0.02em]",
      size === "lg" ? "size-14 text-lg" : "size-11 text-sm",
      TONES[logo.tone],
      className,
    )}
  >
    {logo.text}
  </span>
);
