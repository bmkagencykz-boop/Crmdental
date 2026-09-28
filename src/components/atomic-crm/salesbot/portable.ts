import type { Identifier } from "ra-core";

import type {
  Branch,
  Salesbot,
  Scenario,
  SetAction,
  Step,
  Transport,
} from "./types";
import { TRANSPORTS } from "./types";

/**
 * Import and export of a bot as JSON, to reuse it in another clinic. Ids of
 * a clinic (stages, tags, sources, custom fields, templates, webhooks,
 * services, doctors, employees) mean nothing elsewhere: the export writes
 * their names instead, the import finds the items of the same name in the
 * clinic (case and ё insensitive). What is not found stays empty and the
 * validation of the editor shows it; missing tags can be created first
 * (missingTags).
 */

export const PORTABLE_FORMAT = "dentalcrm.salesbot";

export type PortableBot = {
  format: typeof PORTABLE_FORMAT;
  version: 1;
  name: string;
  description?: string | null;
  triggers: {
    new_lead: boolean;
    transports: Transport[];
    keywords: string[];
    sources: string[];
  };
  scenario: Scenario;
};

type Named = { id: Identifier; name: string };

/** The dictionaries of the clinic that references resolve against */
export type BotDictionaries = {
  /** Stages of the default pipeline first: a name resolves to the first */
  stages: Named[];
  tags: Named[];
  sources: Named[];
  /** Custom fields of the deals */
  fields: Named[];
  templates: Named[];
  webhooks: Named[];
  services: Named[];
  doctors: Named[];
};

const key = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/ё/g, "е");

const nameOf = (items: Named[], id: Identifier | null | undefined) =>
  id == null
    ? null
    : (items.find((item) => String(item.id) === String(id))?.name ?? null);

const idOf = (items: Named[], name: string | null | undefined) =>
  name
    ? (items.find((item) => key(item.name) === key(name))?.id ?? null)
    : null;

const REFERENCE_FIELDS = {
  service_id: "services",
  doctor_id: "doctors",
  source_id: "sources",
} as const;

// --- export ----------------------------------------------------------------

const exportBranch = (branch: Branch, dicts: BotDictionaries): Branch => {
  const {
    stage_id,
    tag_id,
    source_id,
    field_id,
    stage_name: _s,
    tag_name: _t,
    source_name: _so,
    field_name: _f,
    ...rest
  } = branch;
  return {
    ...rest,
    ...(branch.match === "stage"
      ? { stage_name: nameOf(dicts.stages, stage_id) }
      : {}),
    ...(branch.match === "tag" ? { tag_name: nameOf(dicts.tags, tag_id) } : {}),
    ...(branch.match === "source"
      ? { source_name: nameOf(dicts.sources, source_id) }
      : {}),
    ...(branch.match === "field"
      ? { field_name: nameOf(dicts.fields, field_id) }
      : {}),
  };
};

const exportAction = (action: SetAction, dicts: BotDictionaries): SetAction => {
  const {
    stage_id,
    tag_id,
    field_id,
    sales_id: _sales,
    stage_name: _s,
    tag_name: _t,
    field_name: _f,
    value_name: _v,
    ...rest
  } = action;
  const referenced =
    action.kind === "deal_field" && action.field
      ? REFERENCE_FIELDS[action.field as keyof typeof REFERENCE_FIELDS]
      : undefined;
  return {
    ...rest,
    ...(action.kind === "stage"
      ? { stage_name: nameOf(dicts.stages, stage_id) }
      : {}),
    ...(action.kind === "tag_add" || action.kind === "tag_remove"
      ? { tag_name: nameOf(dicts.tags, tag_id) }
      : {}),
    ...(action.kind === "field"
      ? { field_name: nameOf(dicts.fields, field_id) }
      : {}),
    ...(referenced
      ? { value: null, value_name: nameOf(dicts[referenced], action.value) }
      : {}),
  };
};

const exportStep = (step: Step, dicts: BotDictionaries): Step => {
  const {
    template_id,
    webhook_id,
    template_name: _t,
    webhook_name: _w,
    ...rest
  } = step;
  return {
    ...rest,
    ...(step.type === "send_message" && template_id != null
      ? { template_name: nameOf(dicts.templates, template_id) }
      : {}),
    ...(step.type === "webhook"
      ? { webhook_name: nameOf(dicts.webhooks, webhook_id) }
      : {}),
    ...(step.branches
      ? { branches: step.branches.map((b) => exportBranch(b, dicts)) }
      : {}),
    ...(step.actions
      ? { actions: step.actions.map((a) => exportAction(a, dicts)) }
      : {}),
  };
};

/** The bot as portable JSON (names instead of ids) */
export const exportBot = (
  bot: Pick<
    Salesbot,
    | "name"
    | "description"
    | "scenario"
    | "trigger_new_lead"
    | "trigger_transports"
    | "trigger_keywords"
    | "trigger_source_ids"
  >,
  dicts: BotDictionaries,
): PortableBot => ({
  format: PORTABLE_FORMAT,
  version: 1,
  name: bot.name,
  description: bot.description ?? null,
  triggers: {
    new_lead: bot.trigger_new_lead,
    transports: bot.trigger_transports,
    keywords: bot.trigger_keywords,
    sources: bot.trigger_source_ids
      .map((id) => nameOf(dicts.sources, id))
      .filter((name): name is string => !!name),
  },
  scenario: {
    start: bot.scenario.start,
    steps: bot.scenario.steps.map((step) => exportStep(step, dicts)),
  },
});

// --- import ----------------------------------------------------------------

const importBranch = (branch: Branch, dicts: BotDictionaries): Branch => {
  const { stage_name, tag_name, source_name, field_name, ...rest } = branch;
  return {
    ...rest,
    ...(branch.match === "stage"
      ? { stage_id: idOf(dicts.stages, stage_name) ?? branch.stage_id ?? null }
      : {}),
    ...(branch.match === "tag"
      ? { tag_id: idOf(dicts.tags, tag_name) ?? branch.tag_id ?? null }
      : {}),
    ...(branch.match === "source"
      ? {
          source_id:
            idOf(dicts.sources, source_name) ?? branch.source_id ?? null,
        }
      : {}),
    ...(branch.match === "field"
      ? { field_id: idOf(dicts.fields, field_name) ?? branch.field_id ?? null }
      : {}),
  };
};

const importAction = (action: SetAction, dicts: BotDictionaries): SetAction => {
  const { stage_name, tag_name, field_name, value_name, ...rest } = action;
  const referenced =
    action.kind === "deal_field" && action.field
      ? REFERENCE_FIELDS[action.field as keyof typeof REFERENCE_FIELDS]
      : undefined;
  const referencedId = referenced ? idOf(dicts[referenced], value_name) : null;
  return {
    ...rest,
    ...(action.kind === "stage"
      ? { stage_id: idOf(dicts.stages, stage_name) ?? action.stage_id ?? null }
      : {}),
    ...(action.kind === "tag_add" || action.kind === "tag_remove"
      ? { tag_id: idOf(dicts.tags, tag_name) ?? action.tag_id ?? null }
      : {}),
    ...(action.kind === "field"
      ? { field_id: idOf(dicts.fields, field_name) ?? action.field_id ?? null }
      : {}),
    ...(referenced && value_name
      ? { value: referencedId != null ? String(referencedId) : null }
      : {}),
  };
};

const importStep = (step: Step, dicts: BotDictionaries): Step => {
  const { template_name, webhook_name, ...rest } = step;
  return {
    ...rest,
    ...(step.type === "send_message" && template_name
      ? { template_id: idOf(dicts.templates, template_name) }
      : {}),
    ...(step.type === "webhook"
      ? {
          webhook_id:
            idOf(dicts.webhooks, webhook_name) ?? step.webhook_id ?? null,
        }
      : {}),
    ...(step.branches
      ? { branches: step.branches.map((b) => importBranch(b, dicts)) }
      : {}),
    ...(step.actions
      ? { actions: step.actions.map((a) => importAction(a, dicts)) }
      : {}),
  };
};

/** Reads portable JSON (a string or an object); throws on a wrong format */
export const parsePortableBot = (input: string | unknown): PortableBot => {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("salesbot.import.invalid_json");
    }
  }
  const bot = value as Partial<PortableBot> | null;
  if (
    !bot ||
    bot.format !== PORTABLE_FORMAT ||
    typeof bot.name !== "string" ||
    !bot.scenario ||
    !Array.isArray(bot.scenario.steps)
  ) {
    throw new Error("salesbot.import.invalid_format");
  }
  return {
    format: PORTABLE_FORMAT,
    version: 1,
    name: bot.name,
    description: bot.description ?? null,
    triggers: {
      new_lead: !!bot.triggers?.new_lead,
      transports: (bot.triggers?.transports ?? []).filter((t) =>
        (TRANSPORTS as readonly string[]).includes(t),
      ),
      keywords: (bot.triggers?.keywords ?? []).filter(
        (k): k is string => typeof k === "string",
      ),
      sources: (bot.triggers?.sources ?? []).filter(
        (s): s is string => typeof s === "string",
      ),
    },
    scenario: {
      start: bot.scenario.start ?? null,
      steps: bot.scenario.steps,
    },
  };
};

/** Tag names of the bot that the clinic does not have yet */
export const missingTags = (bot: PortableBot, dicts: BotDictionaries) => {
  const names = new Set<string>();
  for (const step of bot.scenario.steps) {
    for (const branch of step.branches ?? []) {
      if (branch.match === "tag" && branch.tag_name) names.add(branch.tag_name);
    }
    for (const action of step.actions ?? []) {
      if (
        (action.kind === "tag_add" || action.kind === "tag_remove") &&
        action.tag_name
      ) {
        names.add(action.tag_name);
      }
    }
  }
  return [...names].filter((name) => idOf(dicts.tags, name) == null);
};

/**
 * The bot for this clinic (a new, inactive bot: the validation shows what
 * is still to choose)
 */
export const importBot = (
  bot: PortableBot,
  dicts: BotDictionaries,
): Omit<
  Salesbot,
  "id" | "version" | "created_at" | "updated_at" | "position"
> => ({
  name: bot.name,
  description: bot.description ?? null,
  is_active: false,
  trigger_new_lead: bot.triggers.new_lead,
  trigger_transports: bot.triggers.transports,
  trigger_keywords: bot.triggers.keywords,
  trigger_source_ids: bot.triggers.sources
    .map((name) => idOf(dicts.sources, name))
    .filter((id): id is Identifier => id != null),
  scenario: {
    start: bot.scenario.start,
    steps: bot.scenario.steps.map((step) => importStep(step, dicts)),
  },
});
