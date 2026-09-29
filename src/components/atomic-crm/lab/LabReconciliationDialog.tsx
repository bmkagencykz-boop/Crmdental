import { useQuery } from "@tanstack/react-query";
import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { exportCsv, type ReportColumn } from "../reports/csv";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { actBasis, actDocument } from "./labActPdf";
import { PillTabs } from "./LabBits";
import { addDays, localDay, shiftMonth, shortDay, tenge } from "./labMath";
import type { LabReconciliationLine } from "./types";
import { download } from "./useLab";

type Range = "month" | "last_month" | "quarter" | "year";

const rangeOf = (range: Range, today: string) => {
  const month = `${today.slice(0, 7)}-01`;
  if (range === "month") return { from: month, to: today };
  if (range === "last_month") {
    const from = shiftMonth(month, -1);
    return { from, to: addDays(month, -1) };
  }
  if (range === "quarter") return { from: shiftMonth(month, -2), to: today };
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
};

/**
 * «Акт сверки» with a lab (owner, head; stage 43): the period, the opening
 * balance, the works billed and the payments by date, the closing balance
 * — on screen, as a PDF for the lab (jsPDF, DejaVu) and as a CSV
 * (public.report_lab_reconciliation).
 */
export const LabReconciliationDialog = ({
  lab,
  onClose,
}: {
  lab: { id: Identifier; name: string };
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { title } = useConfigurationContext();
  const { data: settings } = useOrganizationSettings();
  const today = localDay();
  const [range, setRange] = useState<Range | "custom">("month");
  const [period, setPeriod] = useState(() => rangeOf("month", today));
  const { data: act, isPending } = useQuery({
    queryKey: ["lab_reconciliation", lab.id, period.from, period.to],
    queryFn: () =>
      dataProvider.getLabReconciliation({
        lab_id: lab.id,
        from: period.from,
        to: period.to,
      }),
  });

  const columns: ReportColumn<LabReconciliationLine>[] = [
    {
      label: translate("lab_plus.act.day"),
      render: (line) => shortDay(line.day, true),
    },
    {
      label: translate("lab_plus.act.document"),
      render: (line) => actDocument(line, translate),
    },
    {
      label: translate("lab_plus.act.basis"),
      render: (line) => actBasis(line, translate),
    },
    {
      label: translate("lab_plus.act.debit"),
      render: (line) => (line.debit ? tenge(line.debit) : ""),
      csv: (line) => line.debit || null,
      numeric: true,
    },
    {
      label: translate("lab_plus.act.credit"),
      render: (line) => (line.credit ? tenge(line.credit) : ""),
      csv: (line) => line.credit || null,
      numeric: true,
    },
  ];
  const fileBase = `${translate("lab_plus.act.file")} ${lab.name} ${period.from}—${period.to}`;

  const pdf = async () => {
    if (!act) return;
    try {
      const [{ buildLabActPdf }, { loadEstimateFonts }, { documentFileName }] =
        await Promise.all([
          import("./labActPdf"),
          import("../treatment/estimateFonts"),
          import("../payments/documents"),
        ]);
      const bytes = buildLabActPdf(
        act,
        {
          name: title || "",
          city: settings?.clinic_city,
          address: settings?.clinic_address,
          phone: settings?.clinic_phone,
        },
        await loadEstimateFonts(),
        translate,
      );
      download(bytes, documentFileName(fileBase));
    } catch (error) {
      notify((error as Error)?.message || "lab.pdf.error", { type: "error" });
    }
  };
  const csv = () => {
    if (!act) return;
    const opening: LabReconciliationLine = {
      day: act.period_from,
      kind: "work",
      works: translate("lab_plus.act.opening"),
      debit: Math.max(act.opening, 0),
      credit: Math.max(-act.opening, 0),
    };
    const closing: LabReconciliationLine = {
      day: act.period_to,
      kind: "work",
      works: translate("lab_plus.act.closing"),
      debit: Math.max(act.closing, 0),
      credit: Math.max(-act.closing, 0),
    };
    const summary = (line: LabReconciliationLine) =>
      line === opening || line === closing;
    exportCsv(
      `${fileBase}.csv`,
      columns.map(
        (column, index): ReportColumn<LabReconciliationLine> =>
          index === 1
            ? {
                ...column,
                render: (line: LabReconciliationLine) =>
                  summary(line) ? "" : column.render(line),
              }
            : column,
      ),
      [opening, ...act.lines, closing],
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto rounded-[28px] lg:max-w-4xl"
        data-testid="lab-act-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[26px] font-normal tracking-[-0.02em]">
            {translate("lab_plus.act.title")} · {lab.name}
          </DialogTitle>
          <DialogDescription>
            {translate("lab_plus.act.hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <PillTabs
            size="sm"
            label={translate("lab_plus.act.period")}
            value={range}
            onChange={(value) => {
              setRange(value);
              if (value !== "custom") setPeriod(rangeOf(value, today));
            }}
            options={(["month", "last_month", "quarter", "year"] as const).map(
              (value) => ({
                value,
                label: translate(`lab_plus.act.ranges.${value}`),
              }),
            )}
          />
          <Input
            type="date"
            value={period.from}
            onChange={(event) => {
              setRange("custom");
              setPeriod((current) => ({
                ...current,
                from: event.target.value || current.from,
              }));
            }}
            className="w-40"
            aria-label={translate("lab_plus.act.from")}
          />
          <Input
            type="date"
            value={period.to}
            onChange={(event) => {
              setRange("custom");
              setPeriod((current) => ({
                ...current,
                to: event.target.value || current.to,
              }));
            }}
            className="w-40"
            aria-label={translate("lab_plus.act.to")}
          />
        </div>
        {isPending || !act ? null : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(
                [
                  ["opening", act.opening],
                  ["charged", act.charged],
                  ["paid", act.paid],
                  ["closing", act.closing],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className={cn(
                    "rounded-2xl px-4 py-3",
                    key === "closing" ? "bg-neon text-neon-ink" : "bg-muted",
                  )}
                >
                  <p className="text-xs opacity-80">
                    {translate(`lab_plus.act.${key}`)}
                  </p>
                  <p
                    className="text-[24px] font-light tracking-[-0.02em] tabular-nums"
                    data-testid={`lab-act-${key}`}
                  >
                    {tenge(value)}
                  </p>
                </div>
              ))}
            </div>
            {act.lines.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="lab-act-lines">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      {columns.map((column) => (
                        <th
                          key={column.label}
                          className={cn(
                            "px-3 py-2 font-normal",
                            column.numeric && "text-right",
                          )}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {act.lines.map((line, index) => (
                      <tr key={index} className="border-t border-border/50">
                        {columns.map((column) => (
                          <td
                            key={column.label}
                            className={cn(
                              "px-3 py-2",
                              column.numeric &&
                                "text-right whitespace-nowrap tabular-nums",
                            )}
                          >
                            {column.render(line)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate("lab_plus.act.no_lines")}
              </p>
            )}
            <p className="text-sm">
              {act.closing > 0
                ? translate("lab_plus.act.clinic_owes", {
                    amount: tenge(act.closing),
                  })
                : act.closing < 0
                  ? translate("lab_plus.act.lab_owes", {
                      amount: tenge(-act.closing),
                    })
                  : translate("lab_plus.act.settled")}
            </p>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.close")}
          </Button>
          <Button variant="outline" onClick={csv} disabled={!act}>
            {translate("lab_plus.act.csv")}
          </Button>
          <Button onClick={pdf} disabled={!act} data-testid="lab-act-pdf">
            {translate("lab_plus.act.pdf")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
