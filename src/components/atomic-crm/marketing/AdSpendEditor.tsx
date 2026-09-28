import { useQueryClient } from "@tanstack/react-query";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { findById, useLeadSources } from "../dictionaries/useDictionaries";
import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { ReportSection } from "../reports/ReportTable";
import { monthRange, shiftMonth, spendPeriodLabel } from "./spendMonths";
import type { AdSpend } from "./types";

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * «Расходы на рекламу» (stage 32), under the marketing report: the spend of a
 * month per source and campaign, added, edited in place and deleted. Owner
 * and head only (RLS); a range other than the whole month is allowed, the
 * report counts it pro rata of its days.
 */
export const AdSpendEditor = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { currency } = useConfigurationContext();
  const [month, setMonth] = useState(currentMonth);
  const { from, to } = monthRange(month);
  const { data: sources } = useLeadSources();
  const { data: rows = [], isPending } = useGetList<AdSpend>("ad_spend", {
    filter: { "spent_from@lte": to, "spent_to@gte": from },
    sort: { field: "spent_from", order: "ASC" },
    pagination: { page: 1, perPage: 500 },
  });
  const [update] = useUpdate<AdSpend>();
  const [remove] = useDelete<AdSpend>();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
    queryClient.invalidateQueries({ queryKey: ["reports", "marketing"] });
  };
  const onError = (error: any) =>
    notify(error?.message || "ra.notification.http_error", { type: "error" });
  const save = (row: AdSpend, data: Partial<AdSpend>) =>
    update(
      "ad_spend",
      { id: row.id, data, previousData: row },
      { mutationMode: "pessimistic", onSuccess: refresh, onError },
    );
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const sorted = [...rows].sort(
    (a, b) =>
      (findById(sources, a.source_id)?.position ?? 0) -
        (findById(sources, b.source_id)?.position ?? 0) ||
      (a.campaign ?? "").localeCompare(b.campaign ?? "") ||
      Number(a.id) - Number(b.id),
  );

  return (
    <ReportSection
      title={translate("marketing.spend.title")}
      description={translate("marketing.spend.hint")}
      action={
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-md px-2"
            aria-label={translate("marketing.spend.previous")}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ‹
          </Button>
          <Input
            type="month"
            className="h-8 w-40 rounded-md"
            aria-label={translate("marketing.spend.month")}
            value={month}
            onChange={(event) =>
              event.target.value && setMonth(event.target.value)
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-md px-2"
            aria-label={translate("marketing.spend.next")}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            ›
          </Button>
        </div>
      }
    >
      <div data-testid="ad-spend">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground">
                {translate("marketing.spend.columns.source")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {translate("marketing.spend.columns.campaign")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {translate("marketing.spend.columns.period")}
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                {translate("marketing.spend.columns.amount")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {translate("marketing.spend.columns.comment")}
              </TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.id} data-testid="ad-spend-row">
                <TableCell>
                  {findById(sources, row.source_id)?.name ?? "—"}
                </TableCell>
                <TableCell>
                  <CellInput
                    value={row.campaign ?? ""}
                    label={translate("marketing.spend.columns.campaign")}
                    placeholder={translate("marketing.spend.whole_source")}
                    onSave={(value) =>
                      save(row, { campaign: value.trim() || null })
                    }
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {spendPeriodLabel(row, from, to) ??
                    translate("marketing.spend.whole_month_short")}
                </TableCell>
                <TableCell className="text-right">
                  <CellInput
                    value={String(row.amount)}
                    label={translate("marketing.spend.columns.amount")}
                    numeric
                    onSave={(value) => {
                      const amount = Math.round(Number(value));
                      if (Number.isFinite(amount) && amount >= 0) {
                        save(row, { amount });
                      }
                    }}
                  />
                </TableCell>
                <TableCell>
                  <CellInput
                    value={row.comment ?? ""}
                    label={translate("marketing.spend.columns.comment")}
                    onSave={(value) =>
                      save(row, { comment: value.trim() || null })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md px-2 text-muted-foreground"
                    aria-label={translate("ra.action.delete")}
                    onClick={() =>
                      remove(
                        "ad_spend",
                        { id: row.id, previousData: row },
                        {
                          mutationMode: "pessimistic",
                          onSuccess: refresh,
                          onError,
                        },
                      )
                    }
                  >
                    ×
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isPending && !rows.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {translate("marketing.spend.empty")}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.length ? (
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>
                  {translate("marketing.spend.total")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(total, currency ?? "KZT")}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <AddSpend month={month} onAdded={refresh} />
      </div>
    </ReportSection>
  );
};

/** A cell edited in place, saved on blur or Enter */
const CellInput = ({
  value,
  label,
  placeholder,
  numeric,
  onSave,
}: {
  value: string;
  label: string;
  placeholder?: string;
  numeric?: boolean;
  onSave: (value: string) => void;
}) => (
  <Input
    key={value}
    defaultValue={value}
    aria-label={label}
    placeholder={placeholder}
    inputMode={numeric ? "numeric" : undefined}
    className={
      numeric
        ? "h-8 w-32 rounded-md text-right tabular-nums ml-auto"
        : "h-8 rounded-md"
    }
    onBlur={(event) => {
      if (event.target.value !== value) onSave(event.target.value);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }}
  />
);

const AddSpend = ({
  month,
  onAdded,
}: {
  month: string;
  onAdded: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data: sources } = useLeadSources();
  const [create, { isPending }] = useCreate<AdSpend>();
  const [sourceId, setSourceId] = useState<string>("");
  const [campaign, setCampaign] = useState("");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [customRange, setCustomRange] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });
  const whole = monthRange(month);
  const period = customRange ? range : whole;
  const value = Math.round(Number(amount.replace(/\s/g, "")));
  const valid =
    !!sourceId &&
    amount.trim() !== "" &&
    Number.isFinite(value) &&
    value >= 0 &&
    !!period.from &&
    !!period.to &&
    period.to >= period.from;

  const submit = () => {
    if (!valid) return;
    create(
      "ad_spend",
      {
        data: {
          source_id: Number(sourceId),
          campaign: campaign.trim() || null,
          spent_from: period.from,
          spent_to: period.to,
          amount: value,
          comment: comment.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setCampaign("");
          setAmount("");
          setComment("");
          onAdded();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
      aria-label={translate("marketing.spend.add")}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Select value={sourceId} onValueChange={setSourceId}>
        <SelectTrigger
          className="h-8 w-44 rounded-md"
          aria-label={translate("marketing.spend.columns.source")}
        >
          <SelectValue
            placeholder={translate("marketing.spend.columns.source")}
          />
        </SelectTrigger>
        <SelectContent>
          {sources
            .filter((source) => !source.is_archived)
            .map((source) => (
              <SelectItem key={source.id} value={String(source.id)}>
                {source.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 w-44 rounded-md"
        aria-label={translate("marketing.spend.columns.campaign")}
        placeholder={translate("marketing.spend.campaign_placeholder")}
        value={campaign}
        onChange={(event) => setCampaign(event.target.value)}
      />
      <Input
        className="h-8 w-32 rounded-md text-right"
        inputMode="numeric"
        aria-label={translate("marketing.spend.columns.amount")}
        placeholder={translate("marketing.spend.columns.amount")}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Input
        className="h-8 w-48 rounded-md"
        aria-label={translate("marketing.spend.columns.comment")}
        placeholder={translate("marketing.spend.columns.comment")}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {customRange ? (
        <>
          <Input
            type="date"
            className="h-8 w-36 rounded-md"
            aria-label={translate("marketing.spend.from")}
            value={range.from}
            onChange={(event) =>
              setRange((r) => ({ ...r, from: event.target.value }))
            }
          />
          <Input
            type="date"
            className="h-8 w-36 rounded-md"
            aria-label={translate("marketing.spend.to")}
            value={range.to}
            onChange={(event) =>
              setRange((r) => ({ ...r, to: event.target.value }))
            }
          />
        </>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-md text-xs"
        onClick={() => {
          setCustomRange((value) => !value);
          setRange(whole);
        }}
      >
        {translate(
          customRange
            ? "marketing.spend.whole_month"
            : "marketing.spend.custom_range",
        )}
      </Button>
      <Button
        type="submit"
        size="sm"
        className="h-8 rounded-md"
        disabled={!valid || isPending}
      >
        {translate("marketing.spend.add")}
      </Button>
    </form>
  );
};
