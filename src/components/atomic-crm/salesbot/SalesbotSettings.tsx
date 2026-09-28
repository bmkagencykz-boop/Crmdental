import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import {
  explainError,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import { downloadBot, useCreateBotFromPortable } from "./botFiles";
import { validateScenario } from "./engine";
import { parsePortableBot } from "./portable";
import { BOT_TEMPLATES } from "./templates";
import type { Salesbot, SalesbotSession } from "./types";
import { useBotDictionaries } from "./useBotDictionaries";

const all = { page: 1, perPage: 500 };

/**
 * Settings → «Салесбот»: the bots of the clinic (name, on/off, when they
 * start, conversations), a new one from scratch, from the gallery of
 * templates or from a JSON file; each opens in the editor /salesbots/:id.
 */
export const SalesbotSettings = () => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const lookups = useBotDictionaries();
  const createFromPortable = useCreateBotFromPortable();
  const { update, remove } = useDictionaryMutations("salesbots");
  const [gallery, setGallery] = useState(false);
  const [deleting, setDeleting] = useState<Salesbot | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: bots = [] } = useGetList<Salesbot>("salesbots", {
    pagination: all,
    sort: { field: "position", order: "ASC" },
  });
  const { data: sessions = [] } = useGetList<SalesbotSession>(
    "salesbot_sessions",
    {
      pagination: { page: 1, perPage: 5000 },
      sort: { field: "id", order: "DESC" },
    },
  );
  const position = bots.length
    ? Math.max(...bots.map((bot) => bot.position)) + 1
    : 0;

  const withBusy = async (work: () => Promise<Identifier>) => {
    setBusy(true);
    try {
      const id = await work();
      notify("salesbot.list.created", { type: "info" });
      navigate(`/salesbots/${id}`);
    } catch (error) {
      notify(
        error instanceof Error && error.message.startsWith("salesbot.")
          ? error.message
          : explainError(error),
        { type: "error" },
      );
    } finally {
      setBusy(false);
    }
  };

  const createEmpty = () =>
    withBusy(async () => {
      const { data } = await dataProvider.create<Salesbot>("salesbots", {
        data: {
          name: translate("salesbot.list.untitled"),
          position,
          scenario: {
            start: "s1",
            steps: [{ id: "s1", type: "send_message", text: "", next: null }],
          },
        },
      });
      return data.id;
    });

  const importFile = async (file: File) => {
    const text = await file.text();
    await withBusy(async () => {
      const id = await createFromPortable(
        parsePortableBot(text),
        lookups,
        position,
      );
      notify("salesbot.import.done", { type: "info" });
      return id;
    });
  };

  const triggerSummary = (bot: Salesbot) => {
    const parts: string[] = [];
    if (bot.trigger_new_lead) {
      parts.push(
        [
          translate("salesbot.list.new_lead"),
          ...bot.trigger_transports.map((t) =>
            translate(`salesbot.transports.${t}`),
          ),
        ].join(" · "),
      );
    }
    if (bot.trigger_keywords.length) {
      parts.push(
        translate("salesbot.list.keywords", {
          words: bot.trigger_keywords.join(", "),
        }),
      );
    }
    return parts.length
      ? parts.join("; ")
      : translate("salesbot.list.manual_only");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="salesbot-settings">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setGallery(true)} disabled={busy}>
          {translate("salesbot.list.from_template")}
        </Button>
        <Button variant="outline" onClick={createEmpty} disabled={busy}>
          {translate("salesbot.list.new")}
        </Button>
        <Button
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {translate("salesbot.list.import")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="salesbot-import-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>

      {bots.length ? (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {bots.map((bot) => {
            const own = sessions.filter(
              (s) => String(s.bot_id) === String(bot.id),
            );
            const active = own.filter(
              (s) => s.status === "running" || s.status === "waiting",
            ).length;
            const errors = validateScenario(bot.scenario).length;
            return (
              <li
                key={bot.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                data-testid="salesbot-row"
              >
                <Switch
                  checked={bot.is_active}
                  aria-label={translate("salesbot.list.toggle", {
                    name: bot.name,
                  })}
                  onCheckedChange={(is_active) => update(bot, { is_active })}
                  disabled={!bot.is_active && errors > 0}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/salesbots/${bot.id}`}
                    className="font-medium text-foreground no-underline hover:underline"
                  >
                    {bot.name}
                  </Link>
                  {!bot.is_active ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {translate("salesbot.list.inactive")}
                    </span>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {triggerSummary(bot)}
                    {errors
                      ? ` · ${translate("salesbot.validation.count", { count: errors })}`
                      : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {translate("salesbot.list.sessions", { total: own.length })}
                  {active
                    ? ` · ${translate("salesbot.list.sessions_active", { active })}`
                    : ""}
                </span>
                <div className="flex gap-1">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/salesbots/${bot.id}`}>
                      {translate("salesbot.list.open")}
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadBot(bot, lookups)}
                  >
                    {translate("salesbot.list.export")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(bot)}
                  >
                    {translate("salesbot.list.delete")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {translate("salesbot.list.empty")}
        </p>
      )}

      <Dialog open={gallery} onOpenChange={setGallery}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{translate("salesbot.gallery.title")}</DialogTitle>
            <DialogDescription>
              {translate("salesbot.gallery.hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {BOT_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="flex flex-col gap-2 rounded-md border p-4"
                data-testid="salesbot-template"
              >
                <h3 className="font-semibold">{template.bot.name}</h3>
                <p className="flex-1 text-sm text-muted-foreground">
                  {template.bot.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate("salesbot.gallery.steps", {
                    count: template.bot.scenario.steps.length,
                  })}
                </p>
                <Button
                  disabled={busy || lookups.isPending}
                  onClick={() => {
                    setGallery(false);
                    void withBusy(() =>
                      createFromPortable(template.bot, lookups, position),
                    );
                  }}
                >
                  {translate("salesbot.gallery.create")}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting != null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translate("salesbot.list.delete")}</DialogTitle>
            <DialogDescription>
              {translate("salesbot.list.delete_confirm", {
                name: deleting?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {translate("ra.action.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove(deleting);
                setDeleting(null);
              }}
            >
              {translate("salesbot.list.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
