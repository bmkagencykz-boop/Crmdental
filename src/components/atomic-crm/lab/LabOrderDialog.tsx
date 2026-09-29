import {
  useDataProvider,
  useGetList,
  useGetOne,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { DentalChart } from "../dental-chart/DentalChart";
import { preferredDentition } from "../dental-chart/teeth";
import { useDoctors } from "../dictionaries/useDictionaries";
import { useFileUrl } from "../files/useFiles";
import type { PatientFile } from "../patient-card/types";
import { patientDisplayName } from "../patients/parsePatientText";
import { NativeSelect } from "../payments/PaymentDialog";
import type { CrmDataProvider } from "../providers/types";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import type { Patient, Sale } from "../types";
import { CrossGlyph, PillTabs, PlusGlyph } from "./LabBits";
import {
  STATUS_FLOW,
  VITA_SHADES,
  orderCost,
  shortDay,
  tenge,
} from "./labMath";
import type {
  LabOrder,
  LabOrderItem,
  LabOrderItemPrice,
  LabStatus,
} from "./types";
import { useLabDictionaries, useLabRights, useRefreshLab } from "./useLab";

const NONE = "";
const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);
const idOrNull = (value: string) => (value === NONE ? null : value);

type Form = {
  patient_id: Identifier | null;
  doctor_id: string;
  lab_id: string;
  technician_id: string;
  responsible_id: string;
  plan_id: string;
  stage_id: string;
  teeth: number[];
  shade: string;
  material: string;
  comment: string;
  status: LabStatus;
  sent_at: string;
  fitting1_at: string;
  fitting2_at: string;
  due_at: string;
};

type Line = {
  key: string;
  id?: Identifier;
  work_type_id: string;
  name: string;
  qty: number;
  plan_item_id: string;
  /** The lab price (owner, head): of the saved line */
  price?: number | null;
  priceId?: Identifier;
  priceText?: string;
};

const EMPTY_FORM: Form = {
  patient_id: null,
  doctor_id: NONE,
  lab_id: NONE,
  technician_id: NONE,
  responsible_id: NONE,
  plan_id: NONE,
  stage_id: NONE,
  teeth: [],
  shade: NONE,
  material: "",
  comment: "",
  status: "clinic",
  sent_at: "",
  fitting1_at: "",
  fitting2_at: "",
  due_at: "",
};

let lineKey = 0;
const newLine = (patch: Partial<Line> = {}): Line => ({
  key: `line-${++lineKey}`,
  work_type_id: NONE,
  name: "",
  qty: 1,
  plan_item_id: NONE,
  ...patch,
});

const str = (value: Identifier | null | undefined) =>
  value == null ? NONE : String(value);

/**
 * «Новый заказ-наряд» / «Заказ-наряд № …»: patient, doctor, lab and
 * technician, the plan (and its stage) it is for, the teeth on the dental
 * chart, the works with their quantity (and plan item), the VITA shade,
 * material, comment, the dates and the status; for a saved order, the
 * files (impressions, scans, photos) and the lab prices of its lines
 * (owner, head).
 */
export const LabOrderDialog = ({
  open,
  onClose,
  orderId,
  patientId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this order */
  orderId?: Identifier | null;
  /** A new order of this patient */
  patientId?: Identifier | null;
  onSaved?: (order: LabOrder) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const rights = useLabRights();
  const { labs, technicians, workTypes, prices } = useLabDictionaries();
  const { data: doctors } = useDoctors();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [lines, setLines] = useState<Line[]>([]);
  const [removed, setRemoved] = useState<Identifier[]>([]);
  const [order, setOrder] = useState<LabOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load the order (or start a new one) each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setRemoved([]);
    if (orderId == null) {
      setOrder(null);
      setForm({ ...EMPTY_FORM, patient_id: patientId ?? null });
      setLines([newLine()]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [{ data: saved }, { data: items }] = await Promise.all([
          dataProvider.getOne<LabOrder>("lab_orders", { id: orderId }),
          dataProvider.getList<LabOrderItem>("lab_order_items", {
            filter: { order_id: orderId },
            pagination: { page: 1, perPage: 200 },
            sort: { field: "position", order: "ASC" },
          }),
        ]);
        const itemPrices = rights.seesMoney
          ? (
              await dataProvider.getList<LabOrderItemPrice>(
                "lab_order_item_prices",
                {
                  filter: {
                    "item_id@in": `(${items.map((i) => i.id).join(",") || 0})`,
                  },
                  pagination: { page: 1, perPage: 200 },
                  sort: { field: "id", order: "ASC" },
                },
              )
            ).data
          : [];
        if (cancelled) return;
        setOrder(saved);
        setForm({
          patient_id: saved.patient_id,
          doctor_id: str(saved.doctor_id),
          lab_id: str(saved.lab_id),
          technician_id: str(saved.technician_id),
          responsible_id: str(saved.responsible_id),
          plan_id: str(saved.plan_id),
          stage_id: str(saved.stage_id),
          teeth: saved.teeth ?? [],
          shade: saved.shade ?? NONE,
          material: saved.material ?? "",
          comment: saved.comment ?? "",
          status: saved.status,
          sent_at: saved.sent_at ?? "",
          fitting1_at: saved.fitting1_at ?? "",
          fitting2_at: saved.fitting2_at ?? "",
          due_at: saved.due_at ?? "",
        });
        setLines(
          items.map((item) => {
            const price = itemPrices.find((p) => same(p.item_id, item.id));
            return newLine({
              id: item.id,
              work_type_id: str(item.work_type_id),
              name: item.name,
              qty: item.qty,
              plan_item_id: str(item.plan_item_id),
              price: price?.price ?? null,
              priceId: price?.id,
              priceText: price ? String(price.price) : "",
            });
          }),
        );
      } catch (error) {
        notify((error as Error).message, { type: "error" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const { data: plans = [] } = useGetList<TreatmentPlan>(
    "treatment_plans",
    {
      filter: { patient_id: form.patient_id },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
    },
    { enabled: open && form.patient_id != null },
  );
  const { data: stages = [] } = useGetList<TreatmentStage>(
    "treatment_stages",
    {
      filter: { plan_id: form.plan_id },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "position", order: "ASC" },
    },
    { enabled: open && form.plan_id !== NONE },
  );
  const { data: planItems = [] } = useGetList<TreatmentPlanItem>(
    "treatment_plan_items",
    {
      filter: { plan_id: form.plan_id },
      pagination: { page: 1, perPage: 500 },
      sort: { field: "position", order: "ASC" },
    },
    { enabled: open && form.plan_id !== NONE },
  );
  const stageItems = planItems.filter(
    (item) => form.stage_id === NONE || same(item.stage_id, form.stage_id),
  );

  const labTechnicians = technicians.filter(
    (tech) =>
      (form.lab_id === NONE || same(tech.lab_id, form.lab_id)) &&
      (tech.is_active || same(tech.id, form.technician_id)),
  );
  const priceOf = (workTypeId: string) =>
    prices.find((p) => same(p.work_type_id, workTypeId))?.price ?? 0;
  const linePrice = (line: Line) =>
    line.id != null && line.priceText !== undefined && line.priceText !== ""
      ? Number(line.priceText)
      : line.id != null && line.price != null
        ? line.price
        : priceOf(line.work_type_id);
  const total = orderCost(
    lines.map((line) => ({ qty: line.qty, price: linePrice(line) })),
  );

  const pickPlan = (planId: string) => {
    const plan = plans.find((p) => same(p.id, planId));
    setForm((current) => ({
      ...current,
      plan_id: planId,
      stage_id: NONE,
      doctor_id:
        current.doctor_id === NONE && plan?.doctor_id != null
          ? String(plan.doctor_id)
          : current.doctor_id,
    }));
  };
  const pickPlanItem = (line: Line, itemId: string) => {
    const item = planItems.find((i) => same(i.id, itemId));
    // The teeth of the item join the order's teeth
    const teeth = item?.tooth
      ? (item.tooth.match(/\d{2}/g) ?? []).map(Number)
      : [];
    updateLine(line.key, { plan_item_id: itemId });
    if (teeth.length) {
      setForm((current) => ({
        ...current,
        teeth: [...new Set([...current.teeth, ...teeth])],
      }));
    }
  };
  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  const removeLine = (line: Line) => {
    if (line.id != null) setRemoved((ids) => [...ids, line.id!]);
    setLines((current) => current.filter((l) => l.key !== line.key));
  };

  const save = async () => {
    if (form.patient_id == null) {
      notify("lab.dialog.pick_patient", { type: "warning" });
      return;
    }
    setSaving(true);
    try {
      const data = {
        patient_id: form.patient_id,
        doctor_id: idOrNull(form.doctor_id),
        lab_id: idOrNull(form.lab_id),
        technician_id: idOrNull(form.technician_id),
        responsible_id: idOrNull(form.responsible_id),
        plan_id: idOrNull(form.plan_id),
        stage_id: idOrNull(form.stage_id),
        teeth: form.teeth,
        shade: form.shade || null,
        material: form.material.trim() || null,
        comment: form.comment.trim() || null,
        status: form.status,
        sent_at: form.sent_at || null,
        fitting1_at: form.fitting1_at || null,
        fitting2_at: form.fitting2_at || null,
        due_at: form.due_at || null,
      };
      const { data: saved } = order
        ? await dataProvider.update<LabOrder>("lab_orders", {
            id: order.id,
            data,
            previousData: order,
          })
        : await dataProvider.create<LabOrder>("lab_orders", {
            data: data as Partial<LabOrder>,
          });
      for (const id of removed) {
        await dataProvider.delete("lab_order_items", {
          id,
          previousData: { id },
        });
      }
      let position = 0;
      for (const line of lines) {
        if (line.work_type_id === NONE && !line.name.trim()) continue;
        const itemData = {
          order_id: saved.id,
          work_type_id: idOrNull(line.work_type_id),
          // The name of the work type (a copy the lab sees on the order)
          name:
            line.work_type_id !== NONE
              ? (workTypes.find((w) => same(w.id, line.work_type_id))?.name ??
                line.name)
              : line.name.trim(),
          qty: Math.max(1, Math.min(100, Math.round(Number(line.qty) || 1))),
          plan_item_id: idOrNull(line.plan_item_id),
          position: position++,
        };
        if (line.id != null) {
          await dataProvider.update("lab_order_items", {
            id: line.id,
            data: itemData,
            previousData: { id: line.id },
          });
          const newPrice = Number(line.priceText);
          if (
            rights.seesMoney &&
            line.priceId != null &&
            line.priceText !== "" &&
            Number.isFinite(newPrice) &&
            newPrice !== line.price
          ) {
            await dataProvider.update("lab_order_item_prices", {
              id: line.priceId,
              data: { price: Math.max(0, Math.round(newPrice)) },
              previousData: { id: line.priceId },
            });
          }
        } else {
          await dataProvider.create("lab_order_items", { data: itemData });
        }
      }
      notify(order ? "lab.dialog.saved" : "lab.dialog.created", {
        type: "info",
        messageArgs: { number: saved.number },
      });
      await refresh();
      onSaved?.(saved);
      onClose();
    } catch (error) {
      notify((error as Error).message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!order) return;
    if (
      !window.confirm(
        translate("lab.dialog.delete_confirm", { number: order.number }),
      )
    )
      return;
    try {
      await dataProvider.delete("lab_orders", {
        id: order.id,
        previousData: order,
      });
      notify("lab.dialog.deleted", { type: "info" });
      await refresh();
      onClose();
    } catch (error) {
      notify((error as Error).message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };

  const readOnly = !rights.canWrite;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto rounded-[28px] lg:max-w-4xl"
        data-testid="lab-order-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[26px] font-normal tracking-[-0.02em]">
            {order
              ? translate("lab.dialog.edit_title", { number: order.number })
              : translate("lab.dialog.create_title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {translate("lab.dialog.main")}
          </DialogDescription>
        </DialogHeader>
        {loading ? null : (
          <div className="flex flex-col gap-5">
            <Section title={translate("lab.dialog.main")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <PatientPicker
                    value={form.patient_id}
                    locked={!!order}
                    onChange={(id) =>
                      setForm((current) => ({
                        ...current,
                        patient_id: id,
                        plan_id: NONE,
                        stage_id: NONE,
                      }))
                    }
                  />
                </div>
                <Field label={translate("lab.fields.doctor")}>
                  <NativeSelect
                    value={form.doctor_id}
                    onChange={(value) => set("doctor_id", value)}
                    aria-label={translate("lab.fields.doctor")}
                  >
                    <option value={NONE}>{translate("lab.dialog.none")}</option>
                    {doctors
                      .filter((d) => d.is_active || same(d.id, form.doctor_id))
                      .map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label={translate("lab.fields.responsible")}>
                  <NativeSelect
                    value={form.responsible_id}
                    onChange={(value) => set("responsible_id", value)}
                    aria-label={translate("lab.fields.responsible")}
                  >
                    <option value={NONE}>{translate("lab.dialog.none")}</option>
                    {sales
                      .filter(
                        (s) =>
                          (!s.disabled && s.role !== "integrator") ||
                          same(s.id, form.responsible_id),
                      )
                      .map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {[s.first_name, s.last_name]
                            .filter(Boolean)
                            .join(" ")}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label={translate("lab.fields.lab")}>
                  <NativeSelect
                    value={form.lab_id}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        lab_id: value,
                        technician_id: technicians.some(
                          (t) =>
                            same(t.id, current.technician_id) &&
                            same(t.lab_id, value),
                        )
                          ? current.technician_id
                          : NONE,
                      }))
                    }
                    aria-label={translate("lab.fields.lab")}
                  >
                    <option value={NONE}>{translate("lab.dialog.none")}</option>
                    {labs
                      .filter((l) => l.is_active || same(l.id, form.lab_id))
                      .map((l) => (
                        <option key={l.id} value={String(l.id)}>
                          {l.name}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label={translate("lab.fields.technician")}>
                  <NativeSelect
                    value={form.technician_id}
                    onChange={(value) => {
                      const tech = technicians.find((t) => same(t.id, value));
                      setForm((current) => ({
                        ...current,
                        technician_id: value,
                        lab_id: tech ? String(tech.lab_id) : current.lab_id,
                      }));
                    }}
                    aria-label={translate("lab.fields.technician")}
                  >
                    <option value={NONE}>{translate("lab.dialog.none")}</option>
                    {labTechnicians.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={translate("lab.fields.plan")}>
                  <NativeSelect
                    value={form.plan_id}
                    onChange={pickPlan}
                    aria-label={translate("lab.fields.plan")}
                  >
                    <option value={NONE}>
                      {translate("lab.dialog.no_plan")}
                    </option>
                    {plans.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={translate("lab.fields.stage")}>
                  <NativeSelect
                    value={form.stage_id}
                    onChange={(value) => set("stage_id", value)}
                    aria-label={translate("lab.fields.stage")}
                  >
                    <option value={NONE}>
                      {translate("lab.dialog.no_stage")}
                    </option>
                    {stages.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </Section>

            <Section
              title={translate("lab.fields.teeth")}
              hint={translate("lab.dialog.teeth_hint")}
            >
              <DentalChart
                selected={form.teeth}
                onSelectedChange={(teeth) => set("teeth", teeth)}
                defaultDentition={preferredDentition(form.teeth)}
                disabled={readOnly}
              />
            </Section>

            <Section title={translate("lab.fields.works")}>
              <div className="flex flex-col gap-2" data-testid="lab-works">
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-12 items-center gap-2 rounded-2xl bg-muted/60 p-2"
                  >
                    <div className="col-span-12 md:col-span-5">
                      <NativeSelect
                        value={line.work_type_id}
                        onChange={(value) =>
                          updateLine(line.key, {
                            work_type_id: value,
                            name:
                              workTypes.find((w) => same(w.id, value))?.name ??
                              line.name,
                            priceText: line.id != null ? "" : line.priceText,
                          })
                        }
                        aria-label={translate("lab.fields.work_type")}
                      >
                        <option value={NONE}>
                          {line.name && line.work_type_id === NONE
                            ? line.name
                            : translate("lab.fields.work_type")}
                        </option>
                        {workTypes
                          .filter(
                            (w) => w.is_active || same(w.id, line.work_type_id),
                          )
                          .map((w) => (
                            <option key={w.id} value={String(w.id)}>
                              {w.name}
                            </option>
                          ))}
                      </NativeSelect>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={line.qty}
                      onChange={(event) =>
                        updateLine(line.key, {
                          qty: Number(event.target.value) || 1,
                        })
                      }
                      className="col-span-3 md:col-span-1"
                      aria-label={translate("lab.fields.qty")}
                    />
                    <div className="col-span-9 md:col-span-3">
                      <NativeSelect
                        value={line.plan_item_id}
                        onChange={(value) => pickPlanItem(line, value)}
                        aria-label={translate("lab.fields.plan_item")}
                      >
                        <option value={NONE}>
                          {translate("lab.dialog.no_item")}
                        </option>
                        {stageItems.map((item) => (
                          <option key={item.id} value={String(item.id)}>
                            {[item.tooth, item.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="col-span-10 md:col-span-2">
                      {rights.seesMoney ? (
                        line.id != null && line.priceId != null ? (
                          <Input
                            type="number"
                            min={0}
                            value={line.priceText ?? ""}
                            placeholder={String(priceOf(line.work_type_id))}
                            onChange={(event) =>
                              updateLine(line.key, {
                                priceText: event.target.value,
                              })
                            }
                            aria-label={translate("lab.fields.price")}
                          />
                        ) : (
                          <span
                            className="block truncate px-2 text-sm tabular-nums"
                            title={translate("lab.dialog.price_from_list")}
                          >
                            {tenge(priceOf(line.work_type_id))}
                          </span>
                        )
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line)}
                      className="col-span-2 ml-auto flex size-9 items-center justify-center rounded-full hover:bg-pill md:col-span-1"
                      aria-label={translate("lab.dialog.remove_work")}
                      title={translate("lab.dialog.remove_work")}
                    >
                      <CrossGlyph />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLines((current) => [...current, newLine()])
                    }
                  >
                    <PlusGlyph className="size-3.5" />
                    {translate("lab.dialog.add_work")}
                  </Button>
                  {rights.seesMoney ? (
                    <span className="ml-auto rounded-full bg-neon px-3 py-1.5 text-sm font-medium text-neon-ink tabular-nums">
                      {translate("lab.dialog.money", { amount: tenge(total) })}
                    </span>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section title={translate("lab.fields.shade")}>
              <div className="flex flex-col gap-3">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={translate("lab.fields.shade")}
                >
                  {VITA_SHADES.map((shade) => (
                    <button
                      key={shade}
                      type="button"
                      role="radio"
                      aria-checked={form.shade === shade}
                      onClick={() =>
                        set("shade", form.shade === shade ? NONE : shade)
                      }
                      className={cn(
                        "h-8 min-w-11 rounded-full px-2.5 text-xs tabular-nums transition-colors",
                        form.shade === shade
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-pill",
                      )}
                    >
                      {shade}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label={translate("lab.fields.material")}>
                    <Input
                      value={form.material}
                      onChange={(event) => set("material", event.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <Field label={translate("lab.fields.comment")}>
                    <Textarea
                      value={form.comment}
                      onChange={(event) => set("comment", event.target.value)}
                      rows={2}
                      maxLength={5000}
                      className="rounded-2xl"
                    />
                  </Field>
                </div>
              </div>
            </Section>

            <Section title={translate("lab.dialog.dates")}>
              <div className="flex flex-col gap-3">
                <PillTabs
                  size="sm"
                  label={translate("lab.fields.status")}
                  value={form.status}
                  onChange={(status) => set("status", status)}
                  options={STATUS_FLOW.map((status) => ({
                    value: status,
                    label: translate(`lab.statuses.${status}`),
                  }))}
                />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {(
                    ["sent_at", "fitting1_at", "fitting2_at", "due_at"] as const
                  ).map((field) => (
                    <Field key={field} label={translate(`lab.fields.${field}`)}>
                      <Input
                        type="date"
                        value={form[field]}
                        onChange={(event) => set(field, event.target.value)}
                        aria-label={translate(`lab.fields.${field}`)}
                      />
                    </Field>
                  ))}
                </div>
                {order?.ready_at || order?.delivered_at ? (
                  <p className="text-sm text-muted-foreground">
                    {translate("lab.fields.ready_at")}:{" "}
                    {shortDay(order.ready_at, true)} ·{" "}
                    {translate("lab.fields.delivered_at")}:{" "}
                    {shortDay(order.delivered_at, true)}
                  </p>
                ) : null}
              </div>
            </Section>

            {order ? (
              <OrderFiles order={order} canWrite={rights.canWrite} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate("lab.dialog.files_after_save")}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
              {order && rights.canDelete(order) ? (
                <Button type="button" variant="ghost" onClick={remove}>
                  {translate("lab.dialog.delete")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="ml-auto"
                onClick={onClose}
              >
                {translate("ra.action.cancel")}
              </Button>
              {rights.canWrite ? (
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving || form.patient_id == null}
                  data-testid="lab-order-save"
                >
                  {translate(order ? "ra.action.save" : "lab.dialog.create")}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Section = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3 rounded-[22px] bg-background/60 p-4">
    <div>
      <h3 className="text-[17px] font-normal tracking-[-0.01em]">{title}</h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
);

/** Search a patient by name or phone (the q filter of patients) */
const PatientPicker = ({
  value,
  locked,
  onChange,
}: {
  value: Identifier | null;
  locked: boolean;
  onChange: (id: Identifier | null) => void;
}) => {
  const translate = useTranslate();
  const [q, setQ] = useState("");
  const { data: patient } = useGetOne<Patient>(
    "patients",
    { id: value as Identifier },
    { enabled: value != null },
  );
  const { data: found = [] } = useGetList<Patient>(
    "patients",
    {
      filter: { q: q.trim() },
      pagination: { page: 1, perPage: 8 },
      sort: { field: "last_seen", order: "DESC" },
    },
    { enabled: value == null && q.trim().length >= 2 },
  );
  if (value != null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">
            {translate("lab.fields.patient")}
          </span>
          <span className="text-[20px] font-normal tracking-[-0.01em]">
            {patient ? patientDisplayName(patient) : "…"}
          </span>
        </div>
        {!locked ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(null)}
          >
            {translate("lab.dialog.change_patient")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label={translate("lab.fields.patient")}>
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={translate("lab.dialog.patient_search")}
          autoFocus
          data-testid="lab-patient-search"
        />
      </Field>
      {q.trim().length >= 2 ? (
        found.length ? (
          <ul className="flex flex-col gap-1" role="listbox">
            {found.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onChange(p.id)}
                  className="flex w-full items-center justify-between rounded-2xl bg-muted px-4 py-2 text-left text-sm hover:bg-pill"
                >
                  <span>{patientDisplayName(p)}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.phones?.[0] ?? ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("lab.dialog.no_patients")}
          </p>
        )
      ) : null}
    </div>
  );
};

/** Impressions, scans, photos of the order: patient files tied to it */
const OrderFiles = ({
  order,
  canWrite,
}: {
  order: LabOrder;
  canWrite: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: files = [] } = useGetList<PatientFile>("patient_files", {
    filter: { lab_order_id: order.id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "created_at", order: "DESC" },
  });
  const upload = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setUploading(true);
    for (const file of Array.from(picked)) {
      try {
        await dataProvider.uploadPatientFile(
          order.patient_id,
          file,
          file.type.startsWith("image/") ? "photo" : "document",
          { lab_order_id: order.id },
        );
      } catch (error) {
        notify((error as Error).message || "files.errors.upload", {
          type: "error",
          messageArgs: { name: file.name },
        });
      }
    }
    setUploading(false);
    await refresh();
  };
  const sorted = useMemo(() => files, [files]);
  return (
    <Section
      title={translate("lab.dialog.files")}
      hint={translate("lab.dialog.files_hint")}
    >
      {sorted.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="lab-order-files">
          {sorted.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("lab.dialog.no_files")}
        </p>
      )}
      {canWrite ? (
        <div>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {translate("lab.dialog.upload")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
};

const FileRow = ({ file }: { file: PatientFile }) => {
  const { data: url } = useFileUrl(file.path);
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-sm text-foreground no-underline hover:underline"
        title={file.name}
      >
        {file.name}
      </a>
      <span className="text-xs text-muted-foreground">
        {shortDay(file.created_at.slice(0, 10), true)}
      </span>
    </li>
  );
};
