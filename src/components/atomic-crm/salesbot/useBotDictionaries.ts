import { useGetList, type Identifier } from "ra-core";
import { useMemo } from "react";

import { useEntityFields } from "../custom-fields/useCustomFields";
import {
  useDoctors,
  useLeadSources,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import type { Webhook } from "../pipeline-automation/types";
import type { MessageTemplate, Sale, Tag } from "../types";
import type { BotDictionaries } from "./portable";

const all = { page: 1, perPage: 500 };
const options = { staleTime: 60 * 1000 };

export type BotLookups = BotDictionaries & {
  /** Stages with their pipeline, default pipeline first */
  stageOptions: { id: Identifier; name: string }[];
  sales: { id: Identifier; name: string }[];
  isPending: boolean;
};

/**
 * Everything a scenario refers to, as { id, name } lists: the selects of
 * the editor, the summaries of the cards, import and export by name.
 */
export const useBotDictionaries = (): BotLookups => {
  const { data: pipelines, isPending: pipelinesPending } = usePipelines();
  const { data: stages, isPending: stagesPending } = useStages();
  const { data: sources } = useLeadSources();
  const { data: services } = useServices();
  const { data: doctors } = useDoctors();
  const { data: fields } = useEntityFields("deal");
  const { data: tags = [], isPending: tagsPending } = useGetList<Tag>(
    "tags",
    { pagination: all, sort: { field: "name", order: "ASC" } },
    options,
  );
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: all, sort: { field: "position", order: "ASC" } },
    options,
  );
  const { data: webhooks = [] } = useGetList<Webhook>(
    "webhooks",
    { pagination: all, sort: { field: "id", order: "ASC" } },
    options,
  );
  const { data: sales = [] } = useGetList<Sale>(
    "sales",
    { pagination: all, sort: { field: "last_name", order: "ASC" } },
    options,
  );

  return useMemo(() => {
    const ordered = [...pipelines].sort(
      (a, b) => Number(b.is_default) - Number(a.is_default),
    );
    const sortedStages = ordered.flatMap((pipeline) =>
      stages
        .filter((stage) => String(stage.pipeline_id) === String(pipeline.id))
        .sort((a, b) => a.position - b.position),
    );
    return {
      stages: sortedStages.map((s) => ({ id: s.id, name: s.name })),
      stageOptions: sortedStages.map((s) => ({
        id: s.id,
        name:
          ordered.length > 1
            ? `${s.name} · ${ordered.find((p) => String(p.id) === String(s.pipeline_id))?.name ?? ""}`
            : s.name,
      })),
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      sources: sources.map((s) => ({ id: s.id, name: s.name })),
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      templates: templates.map((t) => ({ id: t.id, name: t.name })),
      webhooks: webhooks.map((w) => ({ id: w.id, name: w.name || w.url })),
      services: services.map((s) => ({ id: s.id, name: s.name })),
      doctors: doctors.map((d) => ({ id: d.id, name: d.name })),
      sales: sales
        .filter((s) => !s.disabled)
        .map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` })),
      isPending: pipelinesPending || stagesPending || tagsPending,
    };
  }, [
    pipelines,
    stages,
    tags,
    sources,
    fields,
    templates,
    webhooks,
    services,
    doctors,
    sales,
    pipelinesPending,
    stagesPending,
    tagsPending,
  ]);
};

export const nameOf = (
  items: { id: Identifier; name: string }[],
  id: Identifier | null | undefined,
) =>
  id == null
    ? undefined
    : items.find((item) => String(item.id) === String(id))?.name;
