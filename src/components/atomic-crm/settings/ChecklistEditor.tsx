import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { Stage, StageChecklistItem } from "../types";
import { useDictionaryMutations } from "./useDictionaryMutations";

/** Checklist of a stage: what must be done before a deal moves further */
export const ChecklistEditor = ({ stage }: { stage: Stage }) => {
  const translate = useTranslate();
  const [text, setText] = useState("");
  const { data: items = [] } = useGetList<StageChecklistItem>(
    "stage_checklist_items",
    {
      filter: { stage_id: stage.id },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
    },
  );
  const { create, remove } = useDictionaryMutations("stage_checklist_items");
  const add = () => {
    if (!text.trim()) return;
    create({ stage_id: stage.id, text: text.trim(), position: items.length });
    setText("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          aria-label={translate("crm.settings.checklist.title", {
            stage: stage.name,
          })}
        >
          <ListChecks className="size-4" />
          <span className="tabular-nums">{items.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-96 flex-col gap-3 p-4" align="end">
        <div>
          <p className="text-sm font-semibold">
            {translate("crm.settings.checklist.title", { stage: stage.name })}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate("crm.settings.checklist.hint")}
          </p>
        </div>
        {items.length ? (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>{item.text}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => remove(item)}
                  aria-label={translate("ra.action.delete")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder={translate("crm.settings.checklist.new_item")}
            aria-label={translate("crm.settings.checklist.new_item")}
          />
          <Button onClick={add} disabled={!text.trim()} size="icon">
            <Plus className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
