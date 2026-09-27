import { SendHorizontal } from "lucide-react";
import { useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useSendMessage } from "./useMessages";

/** Answer the patient in the messenger they wrote from (Enter sends) */
export const MessageComposer = ({ dealId }: { dealId: Identifier }) => {
  const translate = useTranslate();
  const [text, setText] = useState("");
  const { mutate, isPending } = useSendMessage(dealId);
  const send = () => {
    const value = text.trim();
    if (!value || isPending) return;
    mutate(value, { onSuccess: () => setText("") });
  };
  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        rows={2}
        placeholder={translate("crm.messages.placeholder")}
        aria-label={translate("crm.messages.placeholder")}
        className="min-h-12 resize-none"
      />
      <Button
        onClick={send}
        disabled={!text.trim() || isPending}
        aria-label={translate("crm.messages.send")}
        className="shrink-0"
      >
        <SendHorizontal className="size-4" />
        {translate("crm.messages.send")}
      </Button>
    </div>
  );
};
