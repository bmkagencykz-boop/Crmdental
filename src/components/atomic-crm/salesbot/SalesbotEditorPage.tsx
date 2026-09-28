import { useQueryClient } from "@tanstack/react-query";

import {
  useCanAccess,
  useGetOne,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { explainError } from "../settings/useDictionaryMutations";
import { downloadBot } from "./botFiles";
import { validateScenario, type ValidationError } from "./engine";
import { FlowCanvas } from "./FlowCanvas";
import {
  duplicateStep,
  insertStep,
  removeStep,
  updateStep,
} from "./scenarioEdit";
import { Field, StepPanel } from "./StepPanel";
import { TestChat } from "./TestChat";
import {
  TRANSPORTS,
  type Salesbot,
  type Scenario,
  type Transport,
} from "./types";
import { useBotDictionaries, type BotLookups } from "./useBotDictionaries";

type Draft = Pick<
  Salesbot,
  | "name"
  | "description"
  | "scenario"
  | "trigger_new_lead"
  | "trigger_transports"
  | "trigger_source_ids"
  | "trigger_keywords"
>;

const draftOf = (bot: Salesbot): Draft => ({
  name: bot.name,
  description: bot.description ?? null,
  scenario: bot.scenario,
  trigger_new_lead: bot.trigger_new_lead,
  trigger_transports: bot.trigger_transports,
  trigger_source_ids: bot.trigger_source_ids,
  trigger_keywords: bot.trigger_keywords,
});

/**
 * The salesbot editor (/salesbots/:id, full width): the scenario as a
 * vertical flow on the left; on the right the selected step, the bot and
 * its start, the live validation, or the «Тест» chat.
 */
export const SalesbotEditorPage = () => {
  const translate = useTranslate();
  const { id } = useParams();
  const { canAccess, isPending: accessPending } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  const {
    data: bot,
    isPending,
    error,
  } = useGetOne<Salesbot>("salesbots", { id: id! }, { enabled: !!id });
  if (isPending || accessPending) return null;
  if (error || !bot || !canAccess) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {translate("salesbot.editor.not_found")}
      </p>
    );
  }
  return <Editor key={bot.id} bot={bot} />;
};

SalesbotEditorPage.path = "/salesbots/:id";

const Editor = ({ bot }: { bot: Salesbot }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [update, { isPending: saving }] = useUpdate<Salesbot>();
  const lookups = useBotDictionaries();
  const [draft, setDraft] = useState<Draft>(() => draftOf(bot));
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "test">("edit");
  const [keywords, setKeywords] = useState(bot.trigger_keywords.join(", "));
  useEffect(
    () => setKeywords(draft.trigger_keywords.join(", ")),
    [draft.trigger_keywords],
  );
  const errors = useMemo(
    () => validateScenario(draft.scenario),
    [draft.scenario],
  );
  const dirty = JSON.stringify(draftOf(bot)) !== JSON.stringify(draft);
  const step = draft.scenario.steps.find((s) => s.id === selected) ?? null;

  const setScenario = (scenario: Scenario) =>
    setDraft((current) => ({ ...current, scenario }));

  const save = (extra: Partial<Salesbot> = {}) =>
    update(
      "salesbots",
      { id: bot.id, data: { ...draft, ...extra }, previousData: bot },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["salesbots"] });
          notify("salesbot.editor.saved", { type: "info" });
        },
        onError: (error: unknown) =>
          notify(
            error instanceof Error && error.message.startsWith("salesbot.")
              ? error.message
              : explainError(error),
            { type: "error" },
          ),
      },
    );

  return (
    <div
      className="flex h-[calc(100vh-6.5rem)] min-h-[36rem] flex-col gap-4"
      data-testid="salesbot-editor"
    >
      <header className="flex flex-wrap items-center gap-3">
        <Link
          to="/settings?section=salesbots"
          className="flex items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
        >
          {translate("salesbot.editor.back")}
        </Link>
        <Input
          value={draft.name}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
          aria-label={translate("salesbot.editor.name")}
          className="h-9 w-80 max-w-full text-base font-semibold"
        />
        <span className="text-xs text-muted-foreground">
          {translate("salesbot.editor.version", { version: bot.version })}
        </span>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={bot.is_active}
            disabled={saving || (!bot.is_active && errors.length > 0)}
            onCheckedChange={(is_active) => save({ is_active })}
            aria-label={translate("salesbot.editor.active")}
          />
          {translate("salesbot.editor.active")}
        </label>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              {translate("salesbot.editor.unsaved")}
            </span>
          ) : null}
          <div className="flex rounded-md border p-0.5" role="tablist">
            {(["edit", "test"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium",
                  mode === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {translate(
                  value === "edit"
                    ? "salesbot.editor.scenario"
                    : "salesbot.editor.test",
                )}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={() => downloadBot({ ...bot, ...draft }, lookups)}
          >
            {translate("salesbot.list.export")}
          </Button>
          <Button onClick={() => save()} disabled={saving || !dirty}>
            {translate("salesbot.editor.save")}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_26rem] gap-4">
        <section className="glass min-h-0 overflow-auto rounded-md p-4">
          <FlowCanvas
            scenario={draft.scenario}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setMode("edit");
            }}
            onInsert={(anchor, type) => {
              const result = insertStep(draft.scenario, anchor, type);
              setScenario(result.scenario);
              setSelected(result.id);
              setMode("edit");
            }}
            onDuplicate={(id) => {
              const result = duplicateStep(draft.scenario, id);
              setScenario(result.scenario);
              setSelected(result.id);
            }}
            onDelete={(id) => {
              setScenario(removeStep(draft.scenario, id));
              if (selected === id) setSelected(null);
            }}
            errors={errors}
            lookups={lookups}
          />
        </section>
        <aside className="glass flex min-h-0 flex-col gap-4 overflow-y-auto rounded-md p-4">
          {mode === "test" ? (
            <TestChat
              scenario={draft.scenario}
              lookups={lookups}
              valid={errors.length === 0}
            />
          ) : (
            <>
              <ValidationPanel
                errors={errors}
                onSelect={setSelected}
                scenario={draft.scenario}
              />
              {step ? (
                <StepPanel
                  key={step.id}
                  step={step}
                  scenario={draft.scenario}
                  lookups={lookups}
                  onChange={(next) =>
                    setScenario(updateStep(draft.scenario, next))
                  }
                  onMakeStart={() =>
                    setScenario({ ...draft.scenario, start: step.id })
                  }
                  onDelete={() => {
                    setScenario(removeStep(draft.scenario, step.id));
                    setSelected(null);
                  }}
                />
              ) : (
                <BotPanel
                  draft={draft}
                  setDraft={setDraft}
                  keywords={keywords}
                  setKeywords={setKeywords}
                  lookups={lookups}
                />
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

const ValidationPanel = ({
  errors,
  scenario,
  onSelect,
}: {
  errors: ValidationError[];
  scenario: Scenario;
  onSelect: (id: string) => void;
}) => {
  const translate = useTranslate();
  return (
    <section
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        errors.length ? "border-destructive/50" : null,
      )}
      aria-label={translate("salesbot.validation.title")}
      data-testid="salesbot-validation"
    >
      <p className="font-medium">
        {errors.length
          ? translate("salesbot.validation.count", { count: errors.length })
          : translate("salesbot.validation.ok")}
      </p>
      {errors.length ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {errors.map((error, index) => {
            const step = scenario.steps.find((s) => s.id === error.step);
            const label = translate(`salesbot.validation.codes.${error.code}`);
            return (
              <li key={index}>
                {step ? (
                  <button
                    type="button"
                    className="text-left text-xs text-destructive hover:underline"
                    onClick={() => onSelect(step.id)}
                  >
                    {step.id} · {translate(`salesbot.types.${step.type}`)}:{" "}
                    {label}
                  </button>
                ) : (
                  <span className="text-xs text-destructive">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
};

/** The bot itself: description and when it starts */
const BotPanel = ({
  draft,
  setDraft,
  keywords,
  setKeywords,
  lookups,
}: {
  draft: Draft;
  setDraft: (update: (draft: Draft) => Draft) => void;
  keywords: string;
  setKeywords: (value: string) => void;
  lookups: BotLookups;
}) => {
  const translate = useTranslate();
  const patch = (data: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...data }));
  const toggle = <T,>(list: T[], value: T) =>
    list.some((item) => String(item) === String(value))
      ? list.filter((item) => String(item) !== String(value))
      : [...list, value];
  return (
    <div className="flex flex-col gap-4" data-testid="salesbot-bot-panel">
      <div>
        <h3 className="text-base font-semibold">
          {translate("salesbot.editor.settings")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate("salesbot.editor.select_hint")}
        </p>
      </div>
      <Field label={translate("salesbot.triggers.description")}>
        <Textarea
          value={draft.description ?? ""}
          rows={3}
          aria-label={translate("salesbot.triggers.description")}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>
      <h4 className="text-sm font-semibold">
        {translate("salesbot.triggers.title")}
      </h4>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={draft.trigger_new_lead}
          onCheckedChange={(trigger_new_lead) => patch({ trigger_new_lead })}
        />
        {translate("salesbot.triggers.new_lead")}
      </label>
      {draft.trigger_new_lead ? (
        <>
          <Field label={translate("salesbot.triggers.transports")}>
            <Chips
              items={TRANSPORTS.map((t) => ({
                id: t,
                name: translate(`salesbot.transports.${t}`),
              }))}
              value={draft.trigger_transports}
              onToggle={(value) =>
                patch({
                  trigger_transports: toggle(
                    draft.trigger_transports,
                    value as Transport,
                  ),
                })
              }
            />
          </Field>
          <Field label={translate("salesbot.triggers.sources")}>
            <Chips
              items={lookups.sources}
              value={draft.trigger_source_ids}
              onToggle={(value) =>
                patch({
                  trigger_source_ids: toggle(
                    draft.trigger_source_ids,
                    Number(value),
                  ),
                })
              }
            />
          </Field>
        </>
      ) : null}
      <Field label={translate("salesbot.triggers.keywords")}>
        <Input
          value={keywords}
          placeholder={translate("salesbot.triggers.keywords_hint")}
          aria-label={translate("salesbot.triggers.keywords")}
          onChange={(event) => setKeywords(event.target.value)}
          onBlur={() =>
            patch({
              trigger_keywords: [
                ...new Set(
                  keywords
                    .split(",")
                    .map((word) => word.trim().toLowerCase())
                    .filter(Boolean),
                ),
              ],
            })
          }
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {translate("salesbot.triggers.manual")}
      </p>
    </div>
  );
};

const Chips = ({
  items,
  value,
  onToggle,
}: {
  items: { id: string | number; name: string }[];
  value: (string | number)[];
  onToggle: (value: string | number) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {items.map((item) => {
      const on = value.some((v) => String(v) === String(item.id));
      return (
        <button
          key={item.id}
          type="button"
          aria-pressed={on}
          onClick={() => onToggle(item.id)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs",
            on
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.name}
        </button>
      );
    })}
  </div>
);
