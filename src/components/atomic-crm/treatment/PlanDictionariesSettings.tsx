import { useTranslate } from "ra-core";

import { DictionaryEditor } from "../settings/DictionaryEditor";
import { useDirections, usePlanTypes } from "./useTreatmentPlans";

/**
 * Settings → «Планы лечения» (stage 34): the clinic's «Тип плана» (Основной,
 * Альтернативный, Эконом, Премиум…) and «Направление» of the stages
 * (Терапия, Хирургия…): rename, reorder, archive, add.
 */
export const PlanDictionariesSettings = () => {
  const translate = useTranslate();
  const { data: planTypes = [] } = usePlanTypes();
  const { data: directions = [] } = useDirections();
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-normal tracking-[-0.01em]">
          {translate("plan_editor.settings.plan_types")}
        </h3>
        <DictionaryEditor resource="treatment_plan_types" items={planTypes} />
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-normal tracking-[-0.01em]">
          {translate("plan_editor.settings.directions")}
        </h3>
        <DictionaryEditor resource="treatment_directions" items={directions} />
      </section>
    </div>
  );
};
