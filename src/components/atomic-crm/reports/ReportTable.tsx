import { useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { exportCsv, type ReportColumn } from "./csv";

/** A report section: title, CSV export and a table (with bars if asked) */
export const ReportTable = <Row,>({
  title,
  description,
  filename,
  columns,
  rows,
  rowKey,
}: {
  title: string;
  description?: ReactNode;
  filename: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
}) => {
  const translate = useTranslate();
  return (
    <ReportSection
      title={title}
      description={description}
      action={
        <Button
          variant="outline"
          size="sm"
          className="rounded-md"
          disabled={!rows.length}
          onClick={() => exportCsv(filename, columns, rows)}
        >
          {translate("reports.export_csv")}
        </Button>
      }
    >
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.label}
                  className={cn(
                    "text-muted-foreground",
                    column.numeric && "text-right",
                  )}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={rowKey(row, index)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.label}
                    className={cn(
                      "relative",
                      column.numeric && "text-right tabular-nums",
                    )}
                  >
                    {column.bar ? (
                      <Bar share={column.bar(row)}>{column.render(row)}</Bar>
                    ) : (
                      column.render(row)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("reports.empty")}
        </p>
      )}
    </ReportSection>
  );
};

export const ReportSection = ({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section
    className={cn(
      "flex flex-col gap-3 rounded-md border bg-card p-4",
      className,
    )}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** A horizontal bar in the theme's primary color with the value on top */
export const Bar = ({
  share,
  children,
}: {
  share: number;
  children?: ReactNode;
}) => (
  <div className="relative flex min-w-24 items-center">
    <div
      className="absolute inset-y-0 left-0 rounded-md bg-primary/25"
      style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      aria-hidden
    />
    <span className="relative px-2 py-0.5">{children}</span>
  </div>
);

/** A big number with its label */
export const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) => (
  <div className="flex flex-col gap-1 rounded-md border bg-card p-4">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-2xl font-semibold tabular-nums" data-testid="stat">
      {value}
    </span>
    {hint ? (
      <span className="text-xs text-muted-foreground">{hint}</span>
    ) : null}
  </div>
);
