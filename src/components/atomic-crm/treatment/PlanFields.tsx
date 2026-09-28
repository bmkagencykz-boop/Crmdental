import type { Identifier } from "ra-core";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small building blocks of the plan editor page (stage 34), in the studio
 * design: a labelled field, pill inputs and selects.
 */

export const Field = ({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) => (
  <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
    <span className="px-1 text-xs text-muted-foreground">
      {label}
      {required ? <span className="text-neon"> *</span> : null}
    </span>
    {children}
    {hint ? (
      <span className="px-1 text-[11px] text-muted-foreground">{hint}</span>
    ) : null}
  </label>
);

export const pillInput =
  "field h-10 w-full min-w-0 rounded-full px-4 text-sm outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60";

export const PillSelect = ({
  value,
  onChange,
  options,
  empty,
  label,
  disabled,
  className,
}: {
  value: Identifier | string | null | undefined;
  onChange: (value: string | null) => void;
  options: { id: Identifier | string; name: string }[];
  /** The label of the empty choice; none when the field is required */
  empty?: string;
  label: string;
  disabled?: boolean;
  className?: string;
}) => (
  <select
    value={value == null ? "" : String(value)}
    aria-label={label}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value || null)}
    className={cn(pillInput, "appearance-none pr-8", className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23121214' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M7 10l5 5 5-5'/%3E%3C/svg%3E\")",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 0.75rem center",
      backgroundSize: "1rem",
    }}
  >
    {empty != null ? <option value="">{empty}</option> : null}
    {options.map((option) => (
      <option key={String(option.id)} value={String(option.id)}>
        {option.name}
      </option>
    ))}
  </select>
);
