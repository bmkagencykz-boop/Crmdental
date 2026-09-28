import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A cell edited in place: commits on blur or Enter, Escape restores the
 * value. Dense like a spreadsheet, a light pill on focus.
 */
export const EditCell = ({
  value,
  onCommit,
  label,
  className,
  align = "left",
  placeholder,
  inputMode,
  list,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  className?: string;
  align?: "left" | "right";
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  list?: string;
}) => (
  <input
    key={value}
    defaultValue={value}
    aria-label={label}
    placeholder={placeholder}
    inputMode={inputMode}
    list={list}
    onBlur={(event) => {
      if (event.target.value.trim() !== value.trim()) {
        onCommit(event.target.value.trim());
      }
    }}
    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.currentTarget.value = value;
        event.currentTarget.blur();
      }
    }}
    className={cn(
      "h-8 w-full min-w-0 rounded-full border border-transparent bg-transparent px-2.5 text-[13px] transition-colors outline-none placeholder:text-muted-foreground/60 hover:bg-pill focus:border-ring focus:bg-pill",
      align === "right" && "text-right tabular-nums",
      className,
    )}
  />
);

/** A read-only cell of the same size */
export const TextCell = ({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) => (
  <span
    className={cn(
      "block truncate px-2.5 py-1.5 text-[13px]",
      align === "right" && "text-right tabular-nums",
      className,
    )}
  >
    {children}
  </span>
);

/** A small round tool button with a line glyph */
export const RoundIcon = ({
  label,
  onClick,
  children,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    className={cn(
      "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-pill hover:text-foreground disabled:opacity-30",
      className,
    )}
  >
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  </button>
);

/** A choice as a pill: black when active */
export const Chip = ({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-pill text-foreground hover:bg-white",
    )}
  >
    {children}
    {count != null ? (
      <span
        className={cn(
          "tabular-nums",
          active ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    ) : null}
  </button>
);
