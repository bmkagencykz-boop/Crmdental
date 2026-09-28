import { cn } from "@/lib/utils";

import type { VisitStatus } from "./types";
import { STATUS_COLOR } from "./visitStyles";

/**
 * The sign of a status, drawn for the schedule: a colored circle with a
 * clock (booked), a tick (confirmed), a person (came), two ticks (done), a
 * cross (did not come) or a bar (cancelled).
 */
export const StatusGlyph = ({
  status,
  className,
}: {
  status: VisitStatus;
  className?: string;
}) => (
  <svg
    viewBox="0 0 16 16"
    className={cn("shrink-0", className)}
    aria-hidden="true"
    data-status-glyph={status}
  >
    <circle cx="8" cy="8" r="8" fill={STATUS_COLOR[status]} />
    <g
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {status === "scheduled" ? <path d="M8 4.2V8l2.6 1.6" /> : null}
      {status === "confirmed" ? <path d="M4.6 8.3l2.2 2.2 4.6-4.8" /> : null}
      {status === "arrived" ? (
        <>
          <circle cx="8" cy="6" r="1.7" />
          <path d="M4.9 11.6c.6-1.6 1.7-2.4 3.1-2.4s2.5.8 3.1 2.4" />
        </>
      ) : null}
      {status === "completed" ? (
        <path d="M3.4 8.4l1.9 1.9 3.8-4M7.6 10.3l.1.1 4-4.1" />
      ) : null}
      {status === "no_show" ? (
        <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" />
      ) : null}
      {status === "cancelled" ? <path d="M4.8 8h6.4" /> : null}
    </g>
  </svg>
);
