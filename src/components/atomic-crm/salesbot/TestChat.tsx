import { useGetList, useTranslate } from "ra-core";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  previewValues,
  renderTemplate,
} from "../providers/commons/automessages";
import { useConfigurationContext } from "../root/ConfigurationContext";
import {
  advance,
  isActive,
  receiveReply,
  resumeDue,
  startSession,
  type DealFacts,
  type EngineHooks,
  type EngineSession,
} from "./engine";
import type { MessageTemplate } from "../types";
import { actionSummary, formatMinutes } from "./labels";
import type { Scenario, SetAction } from "./types";
import type { BotLookups } from "./useBotDictionaries";

type Line = { from: "bot" | "patient" | "system"; text: string };

/**
 * «Тест»: a chat simulator. The user writes as the patient, the same engine
 * as the database runs the scenario on a pretend deal (first stage, no
 * tags). Nothing is sent or saved; waits can be skipped.
 */
export const TestChat = ({
  scenario,
  lookups,
  valid,
}: {
  scenario: Scenario;
  lookups: BotLookups;
  valid: boolean;
}) => {
  const translate = useTranslate();
  const { title } = useConfigurationContext();
  const [lines, setLines] = useState<Line[]>([]);
  const [session, setSession] = useState<EngineSession | null>(null);
  const [text, setText] = useState("");
  const deal = useRef<DealFacts>({ tags: [] });
  const bottom = useRef<HTMLDivElement>(null);
  const scenarioKey = JSON.stringify(scenario);
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "position", order: "ASC" },
    },
  );

  const hooks = (push: (line: Line) => void): EngineHooks => ({
    deal: () => deal.current,
    render: (body, reply) =>
      renderTemplate(body, {
        ...previewValues(title),
        ответ: reply ?? "",
      }),
    templateBody: (id) =>
      templates.find((t) => String(t.id) === String(id))?.body,
    send: (message) => push({ from: "bot", text: message }),
    applySet: (action: SetAction, reply) => {
      const facts = deal.current;
      switch (action.kind) {
        case "stage":
          facts.stage_id = action.stage_id;
          break;
        case "tag_add":
          facts.tags = [...facts.tags, action.tag_id!];
          break;
        case "tag_remove":
          facts.tags = facts.tags.filter(
            (tag) => String(tag) !== String(action.tag_id),
          );
          break;
        case "field":
          facts.custom_values = {
            ...facts.custom_values,
            [String(action.field_id)]: (action.value ?? "")
              .split("{ответ}")
              .join(reply ?? ""),
          };
          break;
        case "deal_field":
          if (action.field === "source_id") facts.source_id = action.value;
          break;
      }
      push({
        from: "system",
        text: translate("salesbot.test.set", {
          what: actionSummary(
            {
              ...action,
              value: (action.value ?? "").split("{ответ}").join(reply ?? ""),
            },
            translate,
            lookups,
          ),
        }),
      });
      return {};
    },
    createTask: (_step, taskText) =>
      push({
        from: "system",
        text: translate("salesbot.test.task", { text: taskText }),
      }),
    handoff: () => undefined,
    webhook: () => {
      push({ from: "system", text: translate("salesbot.test.webhook") });
      return true;
    },
    log: (entry) => {
      if (entry.kind === "waiting" || entry.kind === "delay") {
        const minutes =
          entry.step?.type === "wait_reply"
            ? entry.step.timeout_minutes
            : entry.step?.minutes;
        push({
          from: "system",
          text: translate(`salesbot.test.${entry.kind}`, {
            time: formatMinutes(minutes ?? 0, translate),
          }),
        });
      } else if (entry.kind === "skipped" || entry.kind === "failed") {
        if (entry.step) {
          push({
            from: "system",
            text: translate("salesbot.test.skipped", {
              reason: entry.text ?? "",
            }),
          });
        }
      }
    },
  });

  /** Runs an engine call, collecting what the bot says and does */
  const run = async (
    step: (hooks: EngineHooks) => Promise<EngineSession>,
    first: Line[] = [],
  ) => {
    const collected: Line[] = [...first];
    const next = await step(hooks((line) => collected.push(line)));
    if (next.status === "done") {
      collected.push({ from: "system", text: translate("salesbot.test.done") });
    } else if (next.status === "handed_off") {
      collected.push({
        from: "system",
        text: translate("salesbot.test.handed_off"),
      });
    } else if (next.status === "failed") {
      collected.push({
        from: "system",
        text: translate("salesbot.test.failed", {
          reason: next.stopped_reason ?? "",
        }),
      });
    }
    setSession(next);
    return collected;
  };

  const restart = async () => {
    deal.current = {
      tags: [],
      stage_id: lookups.stages[0]?.id ?? null,
      custom_values: {},
    };
    setLines([]);
    if (!valid) {
      setSession(null);
      return;
    }
    setLines(await run((h) => advance(startSession(scenario), h)));
  };

  useEffect(() => {
    void restart();
    // Restart when the scenario changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioKey, valid]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const sendReply = async () => {
    const reply = text.trim();
    if (!reply || !session) return;
    setText("");
    const added = await run(
      (h) => receiveReply(session, reply, h),
      [{ from: "patient", text: reply }],
    );
    setLines((previous) => [...previous, ...added]);
  };

  const skipWait = async () => {
    if (!session) return;
    const added = await run((h) => resumeDue(session, h, new Date(), true));
    setLines((previous) => [...previous, ...added]);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="salesbot-test"
    >
      <p className="text-xs text-muted-foreground">
        {translate("salesbot.test.hint")}
      </p>
      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-3"
        role="log"
        aria-label={translate("salesbot.test.title")}
      >
        {!valid ? (
          <p className="text-sm text-muted-foreground">
            {translate("salesbot.test.invalid")}
          </p>
        ) : null}
        <ol className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li
              key={index}
              data-from={line.from}
              className={cn(
                "max-w-[85%] whitespace-pre-line break-words rounded-lg px-3 py-2 text-sm",
                line.from === "bot" && "self-start bg-card shadow-card",
                line.from === "patient" &&
                  "self-end bg-primary text-primary-foreground",
                line.from === "system" &&
                  "self-center bg-transparent px-0 py-0 text-center text-xs text-muted-foreground",
              )}
            >
              {line.text}
            </li>
          ))}
        </ol>
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void sendReply();
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={translate("salesbot.test.placeholder")}
          aria-label={translate("salesbot.test.placeholder")}
          disabled={!session || !isActive(session.status)}
        />
        <Button
          type="submit"
          disabled={!session || !isActive(session.status) || !text.trim()}
        >
          {translate("salesbot.test.send")}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void restart()}>
          {translate("salesbot.test.restart")}
        </Button>
        {session?.status === "waiting" ? (
          <Button variant="outline" size="sm" onClick={() => void skipWait()}>
            {translate("salesbot.test.skip_wait")}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
