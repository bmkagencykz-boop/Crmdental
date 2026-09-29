import {
  useCanAccess,
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
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

import { Sphere3D } from "../misc/Dental3D";
import { NativeSelect, Pills } from "../payments/PaymentDialog";
import { parseAmount } from "../payments/paymentMath";
import type { ServiceCategory } from "../price-list/types";
import { todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Doctor, Sale } from "../types";
import { EmployeeAvatar } from "./PayrollParts";
import {
  shortDay,
  useMonthParam,
  useRefreshPayroll,
  useSchemeSummary,
} from "./usePayroll";
import { schemeAt, schemeError } from "./payrollMath";
import type { CategoryRate, PayrollScheme } from "./types";

type Person = {
  key: string;
  name: string;
  role: string;
  color: string | null;
  doctor_id: Identifier | null;
  sales_id: Identifier | null;
};

/**
 * «Настроить зарплаты» (stage 39): the scheme of every doctor and of the
 * employees paid through the CRM, with its history (a new scheme from a
 * date keeps the past months on the old one). The owner and the head.
 */
export const PayrollSchemesPage = () => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const today = todayKey(timeZone);
  const [month] = useMonthParam();
  const { canAccess, isPending: rightsPending } = useCanAccess({
    resource: "payroll",
    action: "list",
  });
  const { data: schemes = [], isPending } = useGetList<PayrollScheme>(
    "payroll_schemes",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "effective_from", order: "DESC" },
    },
    { enabled: canAccess === true },
  );
  const { data: doctors = [] } = useGetList<Doctor>("doctors", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "position", order: "ASC" },
  });
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "first_name", order: "ASC" },
  });
  const { data: categories = [] } = useGetList<ServiceCategory>(
    "service_categories",
    { pagination: { page: 1, perPage: 500 } },
  );
  const [editing, setEditing] = useState<{
    person: Person;
    scheme: Partial<PayrollScheme> | null;
  } | null>(null);
  const [addedStaff, setAddedStaff] = useState<string[]>([]);
  const [pickStaff, setPickStaff] = useState("");

  const people = useMemo(() => {
    const saleName = (sale: Sale) =>
      [sale.first_name, sale.last_name].filter(Boolean).join(" ");
    const staff = sales.filter(
      (sale) =>
        sale.role !== "integrator" &&
        (schemes.some(
          (scheme) => String(scheme.sales_id) === String(sale.id),
        ) ||
          addedStaff.includes(String(sale.id))),
    );
    return {
      doctors: doctors
        .filter(
          (doctor) =>
            doctor.is_active ||
            schemes.some((s) => String(s.doctor_id) === String(doctor.id)),
        )
        .map(
          (doctor): Person => ({
            key: `d${doctor.id}`,
            name: doctor.name,
            role: doctor.specialty ?? "",
            color: doctor.color ?? null,
            doctor_id: doctor.id,
            sales_id: null,
          }),
        ),
      staff: staff.map(
        (sale): Person => ({
          key: `s${sale.id}`,
          name: saleName(sale),
          role: translate(`payroll.roles.${sale.role}`, { _: sale.role }),
          color: null,
          doctor_id: null,
          sales_id: sale.id,
        }),
      ),
      candidates: sales.filter(
        (sale) =>
          sale.role !== "integrator" &&
          !sale.disabled &&
          !staff.some((row) => String(row.id) === String(sale.id)),
      ),
      saleName,
    };
  }, [doctors, sales, schemes, addedStaff, translate]);

  if (rightsPending) return null;
  if (!canAccess) return <Navigate to="/" replace />;

  const schemesOf = (person: Person) =>
    schemes
      .filter((scheme) =>
        person.doctor_id != null
          ? String(scheme.doctor_id) === String(person.doctor_id)
          : String(scheme.sales_id) === String(person.sales_id),
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return (
    <div className="flex flex-col gap-5" data-testid="payroll-schemes">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link to={`/payroll?month=${month.slice(0, 7)}`}>
            ← {translate("payroll.actions.back")}
          </Link>
        </Button>
        <h2 className="text-[30px] leading-tight font-normal tracking-[-0.03em]">
          {translate("payroll.schemes.title")}
        </h2>
      </div>
      <section className="relative overflow-hidden rounded-[28px] bg-card p-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {translate("payroll.schemes.subtitle")}
        </p>
        <Sphere3D
          size={120}
          tone="soft"
          className="pointer-events-none -top-10 -right-6"
        />
      </section>

      <Group title={translate("payroll.schemes.doctors")}>
        {isPending ? null : people.doctors.length ? (
          people.doctors.map((person) => (
            <PersonRow
              key={person.key}
              person={person}
              schemes={schemesOf(person)}
              today={today}
              categories={categories}
              onEdit={(scheme) => setEditing({ person, scheme })}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("payroll.empty")}
          </p>
        )}
      </Group>

      <Group title={translate("payroll.schemes.staff")}>
        {people.staff.map((person) => (
          <PersonRow
            key={person.key}
            person={person}
            schemes={schemesOf(person)}
            today={today}
            categories={categories}
            onEdit={(scheme) => setEditing({ person, scheme })}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={pickStaff}
            onChange={setPickStaff}
            aria-label={translate("payroll.schemes.add_staff")}
          >
            <option value="">{translate("payroll.schemes.pick_staff")}</option>
            {people.candidates.map((sale) => (
              <option key={sale.id} value={String(sale.id)}>
                {people.saleName(sale)}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={!pickStaff}
            onClick={() => {
              setAddedStaff((list) => [...list, pickStaff]);
              setPickStaff("");
            }}
          >
            {translate("payroll.schemes.add_staff")}
          </Button>
        </div>
      </Group>

      {editing ? (
        <SchemeDialog
          person={editing.person}
          scheme={editing.scheme}
          categories={categories}
          today={today}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
};

PayrollSchemesPage.path = "/payroll/schemes";

const Group = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section
    className="flex flex-col gap-3 rounded-[28px] bg-card p-6"
    aria-label={title}
  >
    <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
      {title}
    </h2>
    {children}
  </section>
);

const PersonRow = ({
  person,
  schemes,
  today,
  categories,
  onEdit,
}: {
  person: Person;
  schemes: PayrollScheme[];
  today: string;
  categories: ServiceCategory[];
  onEdit: (scheme: Partial<PayrollScheme> | null) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPayroll();
  const summary = useSchemeSummary();
  const [remove] = useDelete();
  const current = schemeAt(schemes, person, today);
  const categoryName = (id: unknown) =>
    categories.find((row) => String(row.id) === String(id))?.name ?? "—";
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl bg-muted p-4"
      data-testid="payroll-person"
    >
      <div className="flex flex-wrap items-center gap-3">
        <EmployeeAvatar employee={person} className="size-11 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{person.name}</p>
          <p className="text-xs text-muted-foreground">{person.role}</p>
        </div>
        <Button
          variant={current ? "outline" : "default"}
          onClick={() =>
            onEdit(
              current
                ? { ...current, id: undefined, effective_from: today }
                : null,
            )
          }
        >
          {translate(current ? "payroll.schemes.new" : "payroll.schemes.setup")}
        </Button>
      </div>
      {schemes.length ? (
        <ul className="flex flex-col gap-1.5">
          {schemes.map((scheme) => (
            <li
              key={scheme.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm",
                scheme.id === current?.id ? "bg-card" : "text-muted-foreground",
              )}
            >
              <span className="w-28 shrink-0 text-xs">
                {translate("payroll.schemes.from", {
                  date: shortDay(scheme.effective_from.slice(0, 10)),
                })}
                {scheme.effective_from.slice(0, 4) !== today.slice(0, 4)
                  ? ` ${scheme.effective_from.slice(0, 4)}`
                  : ""}
              </span>
              {scheme.id === current?.id ? (
                <span className="rounded-full bg-neon px-2 py-0.5 text-[11px] font-semibold text-neon-ink">
                  {translate("payroll.schemes.current")}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                {summary(scheme, categoryName)}
              </span>
              <button
                type="button"
                className="rounded-full bg-card px-3 py-1 text-xs hover:bg-pill"
                onClick={() => onEdit(scheme)}
              >
                {translate("payroll.schemes.edit")}
              </button>
              <button
                type="button"
                className="rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (
                    !window.confirm(
                      translate("payroll.schemes.confirm_delete", {
                        date: shortDay(scheme.effective_from.slice(0, 10)),
                      }),
                    )
                  )
                    return;
                  remove(
                    "payroll_schemes",
                    { id: scheme.id, previousData: scheme },
                    {
                      onSuccess: () => {
                        notify("payroll.notify.deleted", { type: "info" });
                        refresh();
                      },
                      onError: (error) =>
                        notify(
                          (error as Error)?.message ||
                            "ra.notification.http_error",
                          { type: "error" },
                        ),
                    },
                  );
                }}
              >
                {translate("payroll.schemes.delete")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("payroll.card.no_scheme")}
        </p>
      )}
    </div>
  );
};

const asText = (value: number | null | undefined) =>
  value == null || Number(value) === 0 ? "" : String(value);

/** The editor of a scheme: a new one (id empty) or a change of one */
const SchemeDialog = ({
  person,
  scheme,
  categories,
  today,
  onClose,
}: {
  person: Person;
  scheme: Partial<PayrollScheme> | null;
  categories: ServiceCategory[];
  today: string;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPayroll();
  const [create, { isPending: creating }] = useCreate();
  const [update, { isPending: updating }] = useUpdate();
  const [effectiveFrom, setEffectiveFrom] = useState(
    scheme?.effective_from?.slice(0, 10) ?? today,
  );
  const [percent, setPercent] = useState(asText(scheme?.percent));
  const [base, setBase] = useState<string>(scheme?.percent_base ?? "price");
  const [deduct, setDeduct] = useState(!!scheme?.deduct_materials);
  const [salary, setSalary] = useState(asText(scheme?.fixed_salary));
  const [visitRate, setVisitRate] = useState(asText(scheme?.visit_rate));
  const [minimum, setMinimum] = useState(asText(scheme?.min_guaranteed));
  const [note, setNote] = useState(scheme?.note ?? "");
  const [rates, setRates] = useState<
    { category_id: string; percent: string }[]
  >(
    (scheme?.category_rates ?? []).map((rate) => ({
      category_id: String(rate.category_id),
      percent: String(rate.percent),
    })),
  );
  const sections = useMemo(() => {
    const roots = categories
      .filter((row) => row.parent_id == null)
      .sort((a, b) => a.position - b.position);
    return roots.flatMap((root) => [
      { id: String(root.id), label: root.name },
      ...categories
        .filter((row) => String(row.parent_id) === String(root.id))
        .sort((a, b) => a.position - b.position)
        .map((row) => ({
          id: String(row.id),
          label: `${root.name} / ${row.name}`,
        })),
    ]);
  }, [categories]);

  const number = (value: string) => {
    const parsed = parseAmount(value);
    return parsed == null || Number.isNaN(parsed) ? 0 : parsed;
  };
  const percentValue = (value: string) =>
    Number(value.replace(",", ".").replace(/[^\d.]/g, "") || 0);
  const data = {
    doctor_id: person.doctor_id,
    sales_id: person.sales_id,
    effective_from: effectiveFrom,
    percent: percentValue(percent),
    percent_base: base as PayrollScheme["percent_base"],
    deduct_materials: deduct,
    fixed_salary: number(salary),
    visit_rate: number(visitRate),
    min_guaranteed: number(minimum),
    category_rates: rates
      .filter((rate) => rate.category_id)
      .map(
        (rate): CategoryRate => ({
          category_id: Number(rate.category_id),
          percent: percentValue(rate.percent),
        }),
      ),
    note: note.trim() || null,
  };
  const error = schemeError(data);
  const onDone = {
    onSuccess: () => {
      notify("payroll.notify.saved", { type: "info" });
      refresh();
      onClose();
    },
    onError: (err: unknown) =>
      notify((err as Error)?.message || "ra.notification.http_error", {
        type: "error",
      }),
  };
  const save = () => {
    if (error) return;
    if (scheme?.id != null) {
      update(
        "payroll_schemes",
        { id: scheme.id, data, previousData: scheme },
        onDone,
      );
    } else {
      create("payroll_schemes", { data }, onDone);
    }
  };
  const isDoctor = person.doctor_id != null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[28px] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-normal">
            {person.name}
          </DialogTitle>
          <DialogDescription>
            {translate("payroll.scheme.hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={translate("payroll.scheme.effective_from")}>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              aria-label={translate("payroll.scheme.effective_from")}
            />
          </Field>
          <Field label={translate("payroll.scheme.fixed_salary")}>
            <Input
              inputMode="numeric"
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
              aria-label={translate("payroll.scheme.fixed_salary")}
            />
          </Field>
          <Field
            label={translate(
              isDoctor
                ? "payroll.scheme.percent"
                : "payroll.scheme.percent_sales",
            )}
          >
            <Input
              inputMode="decimal"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              aria-label={translate(
                isDoctor
                  ? "payroll.scheme.percent"
                  : "payroll.scheme.percent_sales",
              )}
            />
          </Field>
          <Field label={translate("payroll.scheme.visit_rate")}>
            <Input
              inputMode="numeric"
              value={visitRate}
              onChange={(event) => setVisitRate(event.target.value)}
              aria-label={translate("payroll.scheme.visit_rate")}
            />
          </Field>
          <Field label={translate("payroll.scheme.min_guaranteed")}>
            <Input
              inputMode="numeric"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              aria-label={translate("payroll.scheme.min_guaranteed")}
            />
          </Field>
          <Field label={translate("payroll.scheme.note")}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={translate("payroll.scheme.note")}
            />
          </Field>
        </div>
        {isDoctor ? (
          <div className="flex flex-col gap-4">
            <Pills
              label={translate("payroll.scheme.percent_base")}
              value={base}
              onChange={setBase}
              options={(["price", "paid"] as const).map((value) => ({
                value,
                label: translate(`payroll.scheme.bases.${value}`),
              }))}
            />
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={deduct}
                onChange={(event) => setDeduct(event.target.checked)}
                className="size-4 accent-[var(--neon)]"
              />
              {translate("payroll.scheme.deduct_materials")}
            </label>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                {translate("payroll.scheme.category_rates")}
              </span>
              {rates.map((rate, index) => (
                <div key={index} className="flex items-center gap-2">
                  <NativeSelect
                    value={rate.category_id}
                    onChange={(value) =>
                      setRates((list) =>
                        list.map((row, i) =>
                          i === index ? { ...row, category_id: value } : row,
                        ),
                      )
                    }
                    aria-label={translate("payroll.scheme.rate_section")}
                  >
                    <option value="">
                      {translate("payroll.scheme.rate_section")}
                    </option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    inputMode="decimal"
                    className="w-24"
                    value={rate.percent}
                    onChange={(event) =>
                      setRates((list) =>
                        list.map((row, i) =>
                          i === index
                            ? { ...row, percent: event.target.value }
                            : row,
                        ),
                      )
                    }
                    aria-label={translate("payroll.scheme.rate_percent")}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <button
                    type="button"
                    className="rounded-full px-2 text-muted-foreground hover:text-foreground"
                    aria-label={translate("ra.action.remove")}
                    onClick={() =>
                      setRates((list) => list.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button
                variant="outline"
                className="self-start"
                onClick={() =>
                  setRates((list) => [
                    ...list,
                    { category_id: "", percent: "" },
                  ])
                }
              >
                {translate("payroll.scheme.add_rate")}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-tone-red">
            {translate(`payroll.scheme.errors.${error}`)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={!!error || creating || updating}
            data-testid="payroll-scheme-save"
          >
            {translate("payroll.scheme.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
);
