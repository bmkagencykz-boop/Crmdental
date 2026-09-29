import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * The name of a button of the menu, shown next to it on hover and on
 * keyboard focus. Rendered in a portal: the scrolling rail cannot clip it.
 */
export const NavTooltip = ({
  label,
  hint,
  side = "right",
  children,
}: {
  label: ReactNode;
  /** A second, quieter line: «4 новых», «Ctrl+K» */
  hint?: ReactNode;
  side?: "right" | "bottom" | "left" | "top";
  children: ReactNode;
}) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={10}
        collisionPadding={12}
        className="z-[60] flex origin-(--radix-tooltip-content-transform-origin) animate-in flex-col rounded-2xl bg-foreground px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-background shadow-soft fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=right]:slide-in-from-left-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      >
        {label}
        {hint ? (
          <span className="text-xs font-normal text-background/65">{hint}</span>
        ) : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);

/** One provider for the whole app shell: a short delay, then instant */
export const NavTooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={180} skipDelayDuration={400}>
    {children}
  </TooltipPrimitive.Provider>
);
