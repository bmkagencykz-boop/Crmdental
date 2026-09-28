import { useEffect, useRef } from "react";
import { required, useRecordContext, useTranslate } from "ra-core";
import { useFormContext, useWatch } from "react-hook-form";
import { DateTimeInput } from "@/components/admin/date-time-input";
import { NumberInput } from "@/components/admin/number-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import {
  findById,
  getPipelineStages,
  toChoices,
  toDoctorChoices,
  useDoctors,
  useLeadSources,
  useLostReasons,
  useOrganizationSettings,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { PatientInput } from "../patients/PatientInput";
import { CustomFieldInputs } from "../custom-fields/CustomFieldInputs";
import { AccountManagerInput } from "../sales/AccountManagerInput";
import type { Deal } from "../types";
import { branchChoices } from "../branches/branches";
import { useCurrentBranch } from "../branches/useBranches";

/**
 * Fields of a deal (spec §3): patient, pipeline and stage, source, service,
 * doctor and consultation price (stage 13), plan amount, responsible, appointment and visit dates, lost reason,
 * custom fields (stage 19).
 */
export const DealInputs = () => {
  const translate = useTranslate();
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
      <section className="flex flex-col gap-4">
        <SectionTitle>{translate("crm.deals.sections.request")}</SectionTitle>
        <PatientInput />
        <TextInput
          source="name"
          helperText={false}
          placeholder={translate("crm.deals.name_placeholder")}
        />
        <ServiceAndSourceInputs />
        <DoctorAndConsultationInputs />
        <NumberInput
          source="plan_amount"
          defaultValue={0}
          min={0}
          step={1000}
          helperText={false}
        />
      </section>
      <section className="flex flex-col gap-4">
        <SectionTitle>{translate("crm.deals.sections.pipeline")}</SectionTitle>
        <PipelineAndStageInputs />
        <BranchInput />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {translate("resources.deals.fields.sales_id")}
          </span>
          <AccountManagerInput source="sales_id" />
        </div>
        <DateTimeInput source="appointment_at" helperText={false} />
        <DateTimeInput source="visit_at" helperText={false} />
      </section>
      <section className="md:col-span-2">
        <TextInput source="description" multiline rows={3} helperText={false} />
      </section>
      <CustomFieldInputs entity="deal" className="md:col-span-2" />
    </div>
  );
};

const SectionTitle = ({ children }: { children: string }) => (
  <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
    {children}
  </h3>
);

const ServiceAndSourceInputs = () => {
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const serviceId = useWatch({ name: "service_id" });
  const sourceId = useWatch({ name: "source_id" });
  return (
    <div className="grid grid-cols-2 gap-4">
      <SelectInput
        source="service_id"
        choices={toChoices(services, serviceId)}
        helperText={false}
      />
      <SelectInput
        source="source_id"
        choices={toChoices(sources, sourceId)}
        helperText={false}
      />
    </div>
  );
};

/**
 * The branch the patient goes to (stage 33), from the second branch on; a
 * new deal starts in the branch chosen in the top bar
 */
const BranchInput = () => {
  const translate = useTranslate();
  const { branches, enabled, currentId } = useCurrentBranch();
  const branchId = useWatch({ name: "branch_id" });
  if (!enabled && branchId == null) return null;
  return (
    <SelectInput
      source="branch_id"
      label={translate("branches.deal.field")}
      choices={branchChoices(branches, branchId)}
      defaultValue={currentId ?? undefined}
      emptyText="branches.deal.none"
      helperText={false}
    />
  );
};

/** The doctor (active ones, the current one kept) and the consultation price */
const DoctorAndConsultationInputs = () => {
  const { data: doctors } = useDoctors();
  const doctorId = useWatch({ name: "doctor_id" });
  return (
    <div className="grid grid-cols-2 gap-4">
      <SelectInput
        source="doctor_id"
        choices={toDoctorChoices(doctors, doctorId)}
        emptyText="doctors.deal.none"
        helperText={false}
      />
      <NumberInput
        source="consultation_amount"
        min={0}
        step={500}
        helperText={false}
      />
    </div>
  );
};

/**
 * Stages depend on the pipeline: changing the pipeline selects the first
 * stage of the new one. Unless the clinic lets employees choose, a deal moved
 * to another pipeline stays on that first stage (the database enforces it).
 * A lost stage requires a reason.
 */
const PipelineAndStageInputs = () => {
  const translate = useTranslate();
  const record = useRecordContext<Deal>();
  const { data: settings } = useOrganizationSettings();
  const { data: pipelines } = usePipelines();
  const { data: allStages } = useStages();
  const { data: lostReasons } = useLostReasons();
  const { setValue } = useFormContext();
  const pipelineId = useWatch({ name: "pipeline_id" });
  const stageId = useWatch({ name: "stage_id" });
  const lostReasonId = useWatch({ name: "lost_reason_id" });
  const stages = getPipelineStages(allStages, pipelineId);
  const stage = findById(stages, stageId);
  const lockedToFirstStage =
    record?.id != null &&
    String(record.pipeline_id) !== String(pipelineId) &&
    settings?.pipeline_move_mode !== "choose_stage";

  const previousPipeline = useRef(pipelineId);
  useEffect(() => {
    if (previousPipeline.current === pipelineId) return;
    previousPipeline.current = pipelineId;
    if (!findById(stages, stageId) && stages[0]) {
      setValue("stage_id", stages[0].id, { shouldDirty: true });
    }
  }, [pipelineId, stageId, stages, setValue]);
  useEffect(() => {
    if (lockedToFirstStage && stages[0] && stageId !== stages[0].id) {
      setValue("stage_id", stages[0].id, { shouldDirty: true });
    }
  }, [lockedToFirstStage, stageId, stages, setValue]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <SelectInput
          source="pipeline_id"
          choices={pipelines.map((p) => ({ id: p.id, name: p.name }))}
          validate={required()}
          helperText={false}
        />
        <SelectInput
          source="stage_id"
          choices={stages.map((s) => ({ id: s.id, name: s.name }))}
          validate={required()}
          helperText={false}
          disabled={lockedToFirstStage}
        />
      </div>
      {lockedToFirstStage ? (
        <p className="text-xs text-muted-foreground">
          {translate("crm.deals.moved_to_first_stage")}
        </p>
      ) : null}
      {stage?.kind === "lost" ? (
        <div className="flex flex-col gap-4 rounded-lg bg-brand-red/10 p-4">
          <SelectInput
            source="lost_reason_id"
            choices={toChoices(lostReasons, lostReasonId)}
            validate={required()}
            helperText={false}
          />
          <TextInput source="lost_comment" multiline helperText={false} />
        </div>
      ) : null}
    </>
  );
};
