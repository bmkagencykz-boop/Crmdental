import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import {
  DEFAULT_MAILING_SETTINGS,
  MAILING_LIMIT_BOUNDS,
  validateMailingSettings,
} from "./limits";
import { MailingCreate } from "./MailingCreate";
import type { MailingSettings, MailingStatus, MailingSummary } from "./types";

/**
 * Рассылки (owner and head): mailings to a segment of patients over
 * WhatsApp, within the anti-ban limits of the clinic, with their progress.
 */
export const MailingsPage = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { canAccess, isPending } = useCanAccess({
    resource: "mailings",
    action: "list",
  });
  const [creating, setCreating] = useState(false);
  const { data: settings = DEFAULT_MAILING_SETTINGS } = useQuery({
    queryKey: ["mailingSettings"],
    queryFn: () => dataProvider.getMailingSettings(),
    enabled: !!canAccess,
  });
  const { data: mailings, isPending: loading } = useGetList<MailingSummary>(
    "mailings_summary",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: !!canAccess, refetchInterval: 15_000 },
  );

  if (isPending) return null;
  if (!canAccess) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("mailings.forbidden")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {translate("mailings.intro")}
        </p>
        {!creating ? (
          <Button onClick={() => setCreating(true)}>
            {translate("mailings.new")}
          </Button>
        ) : null}
      </div>
      {creating ? (
        <MailingCreate settings={settings} onDone={() => setCreating(false)} />
      ) : null}

      <section
        className="flex flex-col gap-3"
        aria-label={translate("mailings.title")}
      >
        {loading ? (
          <Skeleton className="h-32 rounded-md" />
        ) : mailings?.length ? (
          mailings.map((mailing) => (
            <MailingCard key={mailing.id} mailing={mailing} />
          ))
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {translate("mailings.empty")}
          </p>
        )}
      </section>

      <MailingLimits settings={settings} />
    </div>
  );
};

MailingsPage.path = "/mailings";

const STATUS_STYLE: Record<MailingStatus, string> = {
  scheduled: "bg-primary/15 text-foreground",
  paused: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  done: "bg-secondary text-secondary-foreground",
};

const MailingCard = ({ mailing }: { mailing: MailingSummary }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [update, { isPending }] = useUpdate();
  const total = Math.max(1, mailing.recipients_count);
  const started = new Date(mailing.scheduled_at) <= new Date();
  const status =
    mailing.status === "scheduled" && started ? "running" : mailing.status;

  const setStatus = (next: MailingStatus) =>
    update(
      "mailings",
      { id: mailing.id, data: { status: next }, previousData: mailing },
      {
        mutationMode: "pessimistic",
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: ["mailings_summary"] }),
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );

  const counters = [
    ["queued", mailing.queued_count],
    ["sent", mailing.sent_count],
    ["delivered", mailing.delivered_count],
    ["read", mailing.read_count],
    ["failed", mailing.failed_count],
    ["skipped", mailing.skipped_count + mailing.cancelled_count],
  ] as const;

  return (
    <article
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="mailing-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{mailing.name}</h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              started ? "mailings.card.started" : "mailings.card.scheduled",
              {
                date: new Date(mailing.scheduled_at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              },
            )}
            {" · "}
            {translate("mailings.card.recipients", {
              smart_count: mailing.recipients_count,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              STATUS_STYLE[mailing.status],
            )}
            data-testid="mailing-status"
          >
            {translate(`mailings.statuses.${status}`)}
          </span>
          {mailing.status === "scheduled" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setStatus("paused")}
            >
              {translate("mailings.actions.pause")}
            </Button>
          ) : null}
          {mailing.status === "paused" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setStatus("scheduled")}
            >
              {translate("mailings.actions.resume")}
            </Button>
          ) : null}
          {mailing.status === "scheduled" || mailing.status === "paused" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => {
                if (
                  window.confirm(translate("mailings.actions.cancel_confirm"))
                ) {
                  setStatus("cancelled");
                }
              }}
            >
              {translate("mailings.actions.cancel")}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="flex h-2 overflow-hidden rounded-md bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={mailing.recipients_count}
        aria-valuenow={mailing.recipients_count - mailing.queued_count}
        aria-label={translate("mailings.card.progress")}
      >
        <div
          className="bg-primary"
          style={{ width: `${(mailing.delivered_count / total) * 100}%` }}
        />
        <div
          className="bg-primary/50"
          style={{
            width: `${((mailing.sent_count - mailing.delivered_count) / total) * 100}%`,
          }}
        />
        <div
          className="bg-destructive/60"
          style={{ width: `${(mailing.failed_count / total) * 100}%` }}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {counters.map(([key, value]) => (
          <div key={key} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {translate(`mailings.counters.${key}`)}
            </dt>
            <dd
              className="font-semibold tabular-nums"
              data-testid={`mailing-${key}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
        {mailing.body}
      </p>
    </article>
  );
};

/** Anti-ban limits of the clinic */
const MailingLimits = ({ settings }: { settings: MailingSettings }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MailingSettings | null>(null);
  const value = draft ?? settings;
  const error = validateMailingSettings(value);
  const set = (patch: Partial<MailingSettings>) =>
    setDraft({ ...value, ...patch });

  const save = async () => {
    try {
      await dataProvider.updateMailingSettings(value);
      await queryClient.invalidateQueries({ queryKey: ["mailingSettings"] });
      setDraft(null);
      notify("crm.settings.saved", { type: "info" });
    } catch (e: any) {
      notify(e?.message || "crm.settings.save_error", { type: "error" });
    }
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      aria-labelledby="mailing-limits"
    >
      <div>
        <h2 id="mailing-limits" className="text-base font-semibold">
          {translate("mailings.settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {translate("mailings.settings.hint")}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <Limit label={translate("mailings.settings.per_minute")}>
          <Input
            type="number"
            min={MAILING_LIMIT_BOUNDS.per_minute.min}
            max={MAILING_LIMIT_BOUNDS.per_minute.max}
            className="w-24"
            value={value.per_minute}
            onChange={(e) => set({ per_minute: Number(e.target.value) })}
            aria-label={translate("mailings.settings.per_minute")}
          />
        </Limit>
        <Limit label={translate("mailings.settings.per_day")}>
          <Input
            type="number"
            min={MAILING_LIMIT_BOUNDS.per_day.min}
            max={MAILING_LIMIT_BOUNDS.per_day.max}
            className="w-24"
            value={value.per_day}
            onChange={(e) => set({ per_day: Number(e.target.value) })}
            aria-label={translate("mailings.settings.per_day")}
          />
        </Limit>
        <Limit label={translate("mailings.settings.work_start")}>
          <Input
            type="time"
            className="w-28"
            value={value.work_start}
            onChange={(e) => set({ work_start: e.target.value })}
            aria-label={translate("mailings.settings.work_start")}
          />
        </Limit>
        <Limit label={translate("mailings.settings.work_end")}>
          <Input
            type="time"
            className="w-28"
            value={value.work_end}
            onChange={(e) => set({ work_end: e.target.value })}
            aria-label={translate("mailings.settings.work_end")}
          />
        </Limit>
        <Button onClick={save} disabled={!draft || !!error}>
          {translate("ra.action.save")}
        </Button>
      </div>
      {draft && error ? (
        <p className="text-sm text-destructive" role="alert">
          {translate(error)}
        </p>
      ) : null}
    </section>
  );
};

const Limit = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
);
