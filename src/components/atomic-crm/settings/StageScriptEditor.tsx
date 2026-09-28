import { useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { Stage } from "../types";
import { useDictionaryMutations } from "./useDictionaryMutations";

/** Script of a stage: what the employee says to the patient at this stage */
export const StageScriptEditor = ({ stage }: { stage: Stage }) => {
  const translate = useTranslate();
  const { update } = useDictionaryMutations("stages");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(stage.script ?? "");
  const title = translate("automessages.script.edit", { stage: stage.name });

  const save = () => {
    const script = text.trim() || null;
    if (script !== (stage.script ?? null)) update(stage, { script });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) setText(stage.script ?? "");
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0",
            !stage.script && "text-muted-foreground opacity-60",
          )}
          aria-label={title}
          title={title}
        ></Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-96 flex-col gap-3 p-4" align="end">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            {translate("automessages.script.hint")}
          </p>
        </div>
        <Textarea
          value={text}
          rows={8}
          onChange={(event) => setText(event.target.value)}
          placeholder={translate("automessages.script.placeholder")}
          aria-label={title}
        />
        <Button className="w-fit" onClick={save}>
          {translate("ra.action.save")}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
