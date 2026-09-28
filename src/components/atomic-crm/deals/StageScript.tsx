import { ChevronDown } from "lucide-react";
import { useTranslate } from "ra-core";
import { useState } from "react";
import { cn } from "@/lib/utils";

import { useStages } from "../dictionaries/useDictionaries";
import type { Deal } from "../types";

/** What to say at the current stage (Settings → Pipelines), collapsible */
export const StageScript = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: stages } = useStages();
  const [open, setOpen] = useState(true);
  const stage = stages.find((s) => String(s.id) === String(deal.stage_id));
  if (!stage?.script?.trim()) return null;

  return (
    <section className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <h3 className="flex-1 text-[15px] font-semibold">
          {translate("automessages.script.title")}
        </h3>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <p
          className="whitespace-pre-line px-4 pb-4 text-sm"
          data-testid="stage-script"
        >
          {stage.script}
        </p>
      ) : null}
    </section>
  );
};
