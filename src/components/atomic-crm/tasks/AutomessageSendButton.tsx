import { useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { useSendMessage } from "../messages/useMessages";
import type { Task } from "../types";

/**
 * «Отправить» on the task of a "show to the employee first" automatic
 * message: the text can be edited, then it goes through the usual sending
 * (messenger_send), which marks the message sent and completes the task.
 */
export const AutomessageSendButton = ({ task }: { task: Task }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(task.text ?? "");
  const send = useSendMessage(task.deal_id, task.automessage_id);
  if (task.automessage_id == null || task.done_date) return null;

  const submit = () =>
    send.mutate(text.trim(), {
      onSuccess: () => {
        setOpen(false);
        notify("automessages.task.sent", { type: "info" });
      },
    });

  return (
    <>
      <Button
        size="sm"
        className="mt-1.5 h-7 gap-1.5 px-2.5 text-xs"
        data-testid="automessage-send"
        onClick={() => {
          setText(task.text ?? "");
          setOpen(true);
        }}
      >
        {translate("automessages.task.send")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{translate("automessages.task.title")}</DialogTitle>
            <DialogDescription>
              {translate("automessages.task.hint")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            rows={6}
            onChange={(event) => setText(event.target.value)}
            aria-label={translate("automessages.task.text")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {translate("ra.action.cancel")}
            </Button>
            <Button onClick={submit} disabled={!text.trim() || send.isPending}>
              {translate("automessages.task.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
