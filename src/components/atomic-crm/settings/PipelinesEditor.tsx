import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  findById,
  getDefaultPipeline,
  getPipelineStages,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { ChecklistEditor } from "./ChecklistEditor";
import type { Stage, StageKind } from "../types";
import {
  explainError,
  moveItem,
  useDictionaryMutations,
} from "./useDictionaryMutations";

/** Colors offered for stages, from the brand palette */
export const STAGE_COLORS = [
  "#83A2DB",
  "#9DB5E4",
  "#A9C7E8",
  "#C9B3D0",
  "#FFCE87",
  "#F7B98C",
  "#FD8E8C",
  "#8CC9A7",
  "#262E3F",
];

const KINDS: StageKind[] = ["open", "won", "lost"];

/**
 * Pipelines of the clinic and their stages. The database keeps at least one
 * won and one lost stage per pipeline and refuses to delete stages or
 * pipelines that still hold deals: its errors are shown as they come.
 */
export const PipelinesEditor = () => {
  const translate = useTranslate();
  const { data: pipelines } = usePipelines();
  const { data: allStages } = useStages();
  const [selectedId, setSelectedId] = useState<Identifier>();
  const pipeline =
    findById(pipelines, selectedId) ?? getDefaultPipeline(pipelines);
  const stages = getPipelineStages(allStages, pipeline?.id);
  const pipelineMutations = useDictionaryMutations("pipelines");
  const stageMutations = useDictionaryMutations("stages");
  const [newStage, setNewStage] = useState("");
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();

  // One default pipeline per clinic (unique index): unset, then set
  const setDefault = async () => {
    if (!pipeline) return;
    try {
      const current = pipelines.find((p) => p.is_default);
      if (current && current.id !== pipeline.id) {
        await dataProvider.update("pipelines", {
          id: current.id,
          data: { is_default: false },
          previousData: current,
        });
      }
      await dataProvider.update("pipelines", {
        id: pipeline.id,
        data: { is_default: true },
        previousData: pipeline,
      });
    } catch (error) {
      notify(explainError(error), { type: "error" });
    }
    pipelineMutations.refresh();
  };

  const addStage = () => {
    if (!pipeline || !newStage.trim()) return;
    // New stages go before the closing (won / lost) ones
    const lastOpen = [...stages].reverse().find((s) => s.kind === "open");
    const position = (lastOpen?.position ?? -1) + 1;
    stages
      .filter((stage) => stage.position >= position)
      .forEach((stage) =>
        stageMutations.update(stage, { position: stage.position + 1 }),
      );
    stageMutations.create({
      pipeline_id: pipeline.id,
      name: newStage.trim(),
      position,
      kind: "open",
      color: STAGE_COLORS[stages.length % STAGE_COLORS.length],
    });
    setNewStage("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedId(item.id)}
            aria-pressed={item.id === pipeline?.id}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all",
              item.id === pipeline?.id
                ? "bg-primary text-primary-foreground shadow-soft"
                : "soft text-foreground/80 hover:text-foreground",
            )}
          >
            {item.is_default ? (
              <Star className="size-3.5 fill-current" />
            ) : null}
            {item.name}
          </button>
        ))}
        <NewPipelineButton onCreated={setSelectedId} />
      </div>

      {pipeline ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              key={`${pipeline.id}-${pipeline.name}`}
              defaultValue={pipeline.name}
              aria-label={translate("crm.settings.pipelines.name")}
              className="max-w-sm"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== pipeline.name) {
                  pipelineMutations.update(pipeline, { name: value });
                }
              }}
            />
            {!pipeline.is_default ? (
              <Button variant="outline" onClick={setDefault}>
                <Star className="size-4" />
                {translate("crm.settings.pipelines.make_default")}
              </Button>
            ) : null}
            {pipelines.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  pipelineMutations.remove(pipeline);
                  setSelectedId(undefined);
                }}
              >
                <Trash2 className="size-4" />
                {translate("crm.settings.pipelines.delete")}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            {stages.map((stage, index) => (
              <StageRow
                key={stage.id}
                stage={stage}
                isFirst={index === 0}
                isLast={index === stages.length - 1}
                onMove={(direction) =>
                  moveItem(stages, stage.id, direction).forEach(
                    ([record, position]) =>
                      stageMutations.update(record, { position }),
                  )
                }
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={newStage}
              onChange={(event) => setNewStage(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addStage()}
              placeholder={translate("crm.settings.pipelines.new_stage")}
              aria-label={translate("crm.settings.pipelines.new_stage")}
              className="max-w-sm"
            />
            <Button
              variant="outline"
              onClick={addStage}
              disabled={!newStage.trim()}
            >
              <Plus className="size-4" />
              {translate("crm.settings.add")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {translate("crm.settings.pipelines.rules")}
          </p>
        </div>
      ) : null}
    </div>
  );
};

const StageRow = ({
  stage,
  isFirst,
  isLast,
  onMove,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}) => {
  const translate = useTranslate();
  const { update, remove } = useDictionaryMutations("stages");
  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          aria-label={translate("crm.settings.move_up")}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isLast}
          onClick={() => onMove(1)}
          aria-label={translate("crm.settings.move_down")}
        >
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="size-8 shrink-0 rounded-full border-2 border-card shadow-soft"
            style={{ backgroundColor: stage.color }}
            aria-label={translate("crm.settings.pipelines.color")}
          />
        </PopoverTrigger>
        <PopoverContent className="flex w-auto flex-wrap gap-2 p-3">
          {STAGE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={cn(
                "size-7 rounded-full",
                color === stage.color && "ring-2 ring-ring ring-offset-2",
              )}
              style={{ backgroundColor: color }}
              onClick={() => update(stage, { color })}
              aria-label={color}
            />
          ))}
        </PopoverContent>
      </Popover>
      <Input
        key={`${stage.id}-${stage.name}`}
        defaultValue={stage.name}
        aria-label={translate("crm.settings.name")}
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value && value !== stage.name) update(stage, { name: value });
        }}
      />
      <Select
        value={stage.kind}
        onValueChange={(kind) => update(stage, { kind })}
      >
        <SelectTrigger className="w-44 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {translate(`crm.settings.pipelines.kinds.${kind}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ChecklistEditor stage={stage} />
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={() => remove(stage)}
        aria-label={translate("ra.action.delete")}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
};

const NewPipelineButton = ({
  onCreated,
}: {
  onCreated: (id: Identifier) => void;
}) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const id = await dataProvider.createPipeline(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      await queryClient.invalidateQueries({ queryKey: ["stages"] });
      onCreated(id);
      setName("");
      setOpen(false);
    } catch (error) {
      notify(explainError(error), { type: "error" });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost">
          <Plus className="size-4" />
          {translate("crm.settings.pipelines.new")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 gap-2 p-3">
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && create()}
          placeholder={translate("crm.settings.pipelines.name")}
          aria-label={translate("crm.settings.pipelines.name")}
        />
        <Button onClick={create} disabled={!name.trim()}>
          {translate("crm.settings.add")}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
