import { SendHorizontal } from "lucide-react";
import { useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { QuickReplyTextarea } from "../quick-replies/QuickReplyTextarea";
import { useSendMessage } from "./useMessages";

/**
 * Answer the patient in the messenger they wrote from (Enter sends, "/"
 * inserts a quick reply)
 */
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
      <QuickReplyTextarea
        dealId={dealId}
        value={text}
        onChange={setText}
        onSubmit={send}
        placeholder={translate("crm.messages.placeholder")}
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
