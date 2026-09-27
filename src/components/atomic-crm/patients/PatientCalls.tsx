import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import {
  useCreate,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useGetSalesName } from "../sales/useGetSalesName";
import { callStatusKey } from "../telephony/telephony";
import type { Call } from "../types";

/** "3:04" from seconds */
export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "3:04", "3.5" or "184" (seconds) to seconds */
export const parseDuration = (value: string): number | null => {
  const text = value.trim();
  if (!text) return 0;
  const clock = text.match(/^(\d+):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = text.replace(",", ".").match(/^\d+(\.\d+)?$/);
  if (minutes) return Math.round(Number(minutes[0]) * 60);
  return null;
};

/**
 * Calls of the patient: logged by hand or received from the PBX (telephony).
 */
export const PatientCalls = ({ patientId }: { patientId: Identifier }) => {
  const { data: calls = [], refetch } = useGetList<Call>("calls", {
    filter: { patient_id: patientId },
    sort: { field: "called_at", order: "DESC" },
    pagination: { page: 1, perPage: 50 },
  });

  return (
    <div className="flex flex-col gap-4">
      <CallForm patientId={patientId} onAdded={refetch} />
      {calls.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {calls.map((call) => (
            <li key={call.id} className="py-2.5">
              <CallRow call={call} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

/** Direction, duration and comment of a call, optionally about a deal */
export const CallForm = ({
  patientId,
  dealId,
  onAdded,
}: {
  patientId: Identifier;
  dealId?: Identifier;
  onAdded?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [create, { isPending }] = useCreate();
  const [direction, setDirection] = useState<Call["direction"]>("out");
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const seconds = parseDuration(duration);

  const add = () => {
    if (seconds == null) return;
    create(
      "calls",
      {
        data: {
          patient_id: patientId,
          deal_id: dealId ?? null,
          direction,
          duration_seconds: seconds,
          comment: comment || null,
          called_at: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => {
          setDuration("");
          setComment("");
          notify("crm.calls.added", { type: "info" });
          onAdded?.();
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="radiogroup">
        {(["out", "in"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            onClick={() => setDirection(value)}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors",
              direction === value
                ? "bg-primary text-primary-foreground"
                : "soft hover:bg-card",
            )}
          >
            {value === "out" ? (
              <PhoneOutgoing className="size-4" />
            ) : (
              <PhoneIncoming className="size-4" />
            )}
            {translate(`crm.calls.direction.${value}`)}
          </button>
        ))}
      </div>
      <Input
        aria-label={translate("crm.calls.duration")}
        placeholder={translate("crm.calls.duration")}
        value={duration}
        onChange={(event) => setDuration(event.target.value)}
        className="w-44"
        aria-invalid={seconds == null}
      />
      <Input
        aria-label={translate("crm.calls.comment")}
        placeholder={translate("crm.calls.comment")}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        className="min-w-40 flex-1"
      />
      <Button onClick={add} disabled={seconds == null || isPending}>
        {translate("crm.calls.add")}
      </Button>
    </div>
  );
};

/**
 * Status of a call from the PBX (missed in red), its duration, the comment
 * and the recording player when the PBX sent one.
 */
export const CallSummary = ({ call }: { call: Call }) => {
  const translate = useTranslate();
  const statusKey = callStatusKey(call);
  const missed = call.status === "missed";
  const showDuration = !missed || call.duration_seconds > 0;
  return (
    <>
      <span>
        {statusKey ? (
          <span className={cn("font-medium", missed && "text-destructive")}>
            {translate(statusKey)}
          </span>
        ) : null}
        {statusKey && showDuration ? " · " : null}
        {showDuration ? (
          <span className="tabular-nums">
            {formatDuration(call.duration_seconds)}
          </span>
        ) : null}
        {call.comment ? ` — ${call.comment}` : ""}
      </span>
      {call.recording_url ? (
        <audio
          controls
          preload="none"
          src={call.recording_url}
          aria-label={translate("telephony.call.recording")}
          className="mt-2 block h-9 w-full max-w-sm"
        />
      ) : null}
    </>
  );
};

export const CallRow = ({ call }: { call: Call }) => {
  const translate = useTranslate();
  const author = useGetSalesName(call.sales_id ?? undefined, {
    enabled: call.sales_id != null,
  });
  const Icon = call.direction === "out" ? PhoneOutgoing : PhoneIncoming;
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground",
          call.status === "missed" && call.provider && "text-destructive",
        )}
      />
      <div className="min-w-0 flex-1">
        <p>
          {translate(`crm.calls.direction.${call.direction}`)} ·{" "}
          <CallSummary call={call} />
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(call.called_at).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {author ? ` · ${author}` : ""}
        </p>
      </div>
    </div>
  );
};
