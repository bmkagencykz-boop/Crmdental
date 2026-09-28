import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";
import { leadFormSnippet } from "./leadWebhook";
import { UtmSourcesSettings } from "../marketing/UtmSourcesSettings";

const QUERY_KEY = ["lead_webhook"];

/**
 * Settings → Website requests (spec §5): the clinic's webhook address for
 * its website, Tilda and 2GIS, a ready-made form, and a test request.
 * Owner and head only (the token is checked by the database).
 */
export const LeadSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data: webhook, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => dataProvider.getLeadWebhook(),
  });
  const regenerate = useMutation({
    mutationFn: () => dataProvider.regenerateLeadWebhook(),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      setConfirming(false);
      notify("leads.regenerated", { type: "info" });
    },
    onError: () => notify("leads.load_error", { type: "error" }),
  });
  const test = useMutation({
    mutationFn: () => dataProvider.sendTestLead(webhook!.url),
    onSuccess: () => {
      for (const key of ["deals", "patients", "deal_notes", "tasks"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      notify("leads.test_sent", { type: "info" });
    },
    onError: () => notify("leads.test_error", { type: "error" }),
  });

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("leads.load_error")}
      </p>
    );
  }
  if (!webhook) return null;

  const snippet = leadFormSnippet(webhook.url, {
    name: translate("leads.snippet.name"),
    phone: translate("leads.snippet.phone"),
    comment: translate("leads.snippet.comment"),
    submit: translate("leads.snippet.submit"),
    thanks: translate("leads.snippet.thanks"),
    error: translate("leads.snippet.error"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-2">
        <label htmlFor="lead-webhook-url" className="text-sm font-medium">
          {translate("leads.url")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="lead-webhook-url"
            readOnly
            value={webhook.url}
            className="min-w-0 flex-1 font-mono text-xs"
            onFocus={(event) => event.target.select()}
          />
          <CopyButton text={webhook.url} label={translate("leads.copy")} />
          <Button
            variant="outline"
            onClick={() => setConfirming(true)}
            disabled={regenerate.isPending}
          >
            {translate("leads.regenerate")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("leads.url_help")}
        </p>
      </div>

      <div>
        <Button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          variant="secondary"
        >
          {translate("leads.test")}
        </Button>
      </div>

      <Block title={translate("leads.fields_title")}>
        <p>{translate("leads.fields_help")}</p>
      </Block>

      <UtmSourcesSettings />

      <Block
        title={translate("leads.snippet_title")}
        action={
          <CopyButton text={snippet} label={translate("leads.copy_code")} />
        }
      >
        <p>{translate("leads.snippet_help")}</p>
        <pre
          aria-label={translate("leads.snippet_title")}
          className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs text-foreground"
        >
          {snippet}
        </pre>
      </Block>

      <Block title={translate("leads.tilda_title")}>
        <Steps text={translate("leads.tilda_steps")} />
      </Block>

      <Block title={translate("leads.twogis_title")}>
        <Steps text={translate("leads.twogis_steps")} />
      </Block>

      <Confirm
        isOpen={confirming}
        title="leads.regenerate_title"
        content="leads.regenerate_confirm"
        onConfirm={() => regenerate.mutate()}
        onClose={() => setConfirming(false)}
        loading={regenerate.isPending}
      />
    </div>
  );
};

const Block = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section
    aria-label={title}
    className="flex max-w-3xl flex-col gap-2 rounded-md border bg-card p-4 text-sm"
  >
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">{title}</h3>
      {action}
    </div>
    <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>
  </section>
);

/** Numbered steps, one per line of the translation */
const Steps = ({ text }: { text: string }) => (
  <ol className="list-decimal space-y-1 pl-5">
    {text.split("\n").map((line) => (
      <li key={line}>{line}</li>
    ))}
  </ol>
);

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const translate = useTranslate();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure context): the field can still be selected
    }
  };
  return (
    <Button variant="outline" onClick={copy} type="button">
      {copied ? translate("leads.copied") : label}
    </Button>
  );
};
