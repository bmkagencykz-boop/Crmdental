import { useMutation } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import {
  ShowBase,
  useDataProvider,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { DeleteButton } from "@/components/admin/delete-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import {
  findById,
  useLeadSources,
  useLostReasons,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Deal } from "../types";
import { TagsListEdit } from "../patients/TagsListEdit";
import { DealPayments } from "./DealPayments";
import { DealTimeline } from "./DealTimeline";
import { StageChecklist } from "./StageChecklist";

export const DealShow = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const handleClose = () => {
    redirect("list", "deals");
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto p-6 lg:max-w-6xl">
        {id ? (
          <ShowBase id={id}>
            <DealShowContent />
          </ShowBase>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const DealShowContent = () => {
  const translate = useTranslate();
  const record = useRecordContext<Deal>();
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: lostReasons } = useLostReasons();
  const salesName = useGetSalesName(record?.sales_id ?? undefined, {
    enabled: record?.sales_id != null,
  });
  // The dialog needs a title while the deal loads
  if (!record) {
    return (
      <DialogTitle className="sr-only">
        {translate("resources.deals.forcedCaseName")}
      </DialogTitle>
    );
  }

  const stage = findById(stages, record.stage_id);
  const patientName = patientDisplayName({
    last_name: record.patient_last_name,
    first_name: record.patient_first_name,
  });

  return (
    <div className="flex flex-col gap-6">
      {record.archived_at ? (
        <div className="rounded-2xl bg-brand-yellow/40 px-5 py-3 text-sm font-semibold">
          {translate("resources.deals.archived.title")}
        </div>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-4 pr-10">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-2xl font-bold tracking-[-0.02em]">
            <Link
              to={`/patients/${record.patient_id}/show`}
              className="hover:underline"
            >
              {patientName}
            </Link>
          </DialogTitle>
          <p className="text-muted-foreground">
            {record.name || findById(services, record.service_id)?.name}
            {record.patient_phone ? ` · ${record.patient_phone}` : ""}
          </p>
          {stage ? (
            <span
              className="mt-1 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: `${stage.color}33` }}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              {findById(pipelines, record.pipeline_id)?.name} · {stage.name}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {record.archived_at ? (
            <>
              <UnarchiveButton record={record} />
              <DeleteButton />
            </>
          ) : (
            <>
              <ArchiveButton record={record} />
              <Button asChild>
                <Link to={`/deals/${record.id}`}>
                  <Pencil className="size-4" />
                  {translate("ra.action.edit")}
                </Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title={translate("crm.deals.sections.details")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              <Field label={translate("resources.deals.fields.service_id")}>
                {findById(services, record.service_id)?.name}
              </Field>
              <Field label={translate("resources.deals.fields.source_id")}>
                {findById(sources, record.source_id)?.name}
              </Field>
              <Field label={translate("resources.deals.fields.sales_id")}>
                {salesName || translate("crm.deals.unassigned")}
              </Field>
              <Field label={translate("resources.deals.fields.appointment_at")}>
                {formatDateTime(record.appointment_at)}
              </Field>
              <Field label={translate("resources.deals.fields.visit_at")}>
                {formatDateTime(record.visit_at)}
              </Field>
              <Field label={translate("resources.deals.fields.created_at")}>
                {formatDateTime(record.created_at)}
              </Field>
              {stage?.kind === "lost" ? (
                <Field
                  label={translate("resources.deals.fields.lost_reason_id")}
                >
                  {findById(lostReasons, record.lost_reason_id)?.name}
                  {record.lost_comment ? ` — ${record.lost_comment}` : ""}
                </Field>
              ) : null}
            </dl>
            {record.description ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-6">
                {record.description}
              </p>
            ) : null}
          </Panel>
          <StageChecklist deal={record} />
          <Panel title={translate("crm.deals.sections.tags")}>
            <TagsListEdit resource="deals" />
          </Panel>
          <Panel title={translate("crm.deals.sections.payments")}>
            <DealPayments deal={record} />
          </Panel>
        </div>
        <Panel title={translate("crm.deals.timeline.title")}>
          <DealTimeline deal={record} />
        </Panel>
      </div>
    </div>
  );
};

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section className="rounded-[1.5rem] bg-muted/60 p-5">
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children || "—"}</dd>
  </>
);

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const ArchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const [update] = useUpdate();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();
  const handleClick = () => {
    update(
      "deals",
      {
        id: record.id,
        data: { archived_at: new Date().toISOString() },
        previousData: record,
      },
      {
        onSuccess: () => {
          redirect("list", "deals");
          notify("resources.deals.archived.success", {
            type: "info",
            undoable: false,
          });
          refresh();
        },
        onError: () => {
          notify("resources.deals.archived.error", { type: "error" });
        },
      },
    );
  };

  return (
    <Button onClick={handleClick} variant="outline">
      <Archive className="size-4" />
      {translate("resources.deals.archived.action")}
    </Button>
  );
};

const UnarchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();

  const { mutate } = useMutation({
    mutationFn: () => dataProvider.unarchiveDeal(record),
    onSuccess: () => {
      redirect("list", "deals");
      notify("resources.deals.unarchived.success", {
        type: "info",
        undoable: false,
      });
      refresh();
    },
    onError: () => {
      notify("resources.deals.unarchived.error", { type: "error" });
    },
  });

  return (
    <Button onClick={() => mutate()} variant="outline">
      <ArchiveRestore className="size-4" />
      {translate("resources.deals.unarchived.action")}
    </Button>
  );
};
