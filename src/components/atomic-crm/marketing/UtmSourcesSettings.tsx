import { useQueryClient } from "@tanstack/react-query";
import { useNotify, useTranslate, useUpdate } from "ra-core";
import { Input } from "@/components/ui/input";

import { useLeadSources } from "../dictionaries/useDictionaries";
import type { LeadSource } from "../types";
import { parseUtmSources } from "./marketingMath";

/**
 * Settings → Заявки с сайта → «UTM-метки источников» (stage 32): the
 * utm_source values of every lead source, comma-separated. A request or a
 * deal with such a utm_source gets that source (private.utm_lead_source);
 * the code and the name of a source match without being listed.
 */
export const UtmSourcesSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [update] = useUpdate<LeadSource>();
  const { data: sources } = useLeadSources();

  const save = (source: LeadSource, text: string) => {
    const next = parseUtmSources(text);
    if (next.join(",") === (source.utm_sources ?? []).join(",")) return;
    update(
      "lead_sources",
      { id: source.id, data: { utm_sources: next }, previousData: source },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["lead_sources"] });
          notify("marketing.utm_sources.saved", { type: "info" });
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  return (
    <section
      aria-label={translate("marketing.utm_sources.title")}
      className="flex max-w-3xl flex-col gap-2 rounded-md border bg-card p-4 text-sm"
    >
      <h3 className="font-semibold">
        {translate("marketing.utm_sources.title")}
      </h3>
      <p className="text-muted-foreground">
        {translate("marketing.utm_sources.help")}
      </p>
      <div className="grid grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1.5">
        {sources
          .filter((source) => !source.is_archived)
          .map((source) => (
            <UtmSourceRow key={source.id} source={source} onSave={save} />
          ))}
      </div>
    </section>
  );
};

const UtmSourceRow = ({
  source,
  onSave,
}: {
  source: LeadSource;
  onSave: (source: LeadSource, text: string) => void;
}) => {
  const translate = useTranslate();
  const current = (source.utm_sources ?? []).join(", ");
  return (
    <>
      <label htmlFor={`utm-sources-${source.id}`} className="truncate">
        {source.name}
      </label>
      <Input
        // Remounted with the saved value
        key={current}
        id={`utm-sources-${source.id}`}
        defaultValue={current}
        placeholder={
          source.code
            ? translate("marketing.utm_sources.placeholder_code", {
                code: source.code,
              })
            : translate("marketing.utm_sources.placeholder")
        }
        className="h-8 rounded-md font-mono text-xs"
        onBlur={(event) => onSave(source, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </>
  );
};
