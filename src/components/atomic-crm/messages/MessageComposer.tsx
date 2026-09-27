import { Paperclip, SendHorizontal, X } from "lucide-react";
import { useNotify, useTranslate, type Identifier } from "ra-core";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

import {
  FILE_ACCEPT,
  fileKind,
  formatFileSize,
  validateFile,
} from "../files/fileTypes";
import { KIND_ICONS } from "../files/fileIcons";
import { QuickReplyTextarea } from "../quick-replies/QuickReplyTextarea";
import { useSendMessage } from "./useMessages";

/**
 * Answer the patient in the messenger they wrote from (Enter sends, "/"
 * inserts a quick reply). The paperclip attaches a file: the text becomes
 * its optional caption.
 */
export const MessageComposer = ({ dealId }: { dealId: Identifier }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { mutate, isPending } = useSendMessage(dealId);
  const canSend = (!!text.trim() || !!file) && !isPending;

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const problem = validateFile(picked);
    if (problem) {
      notify(`files.errors.${problem}`, { type: "error" });
      return;
    }
    setFile(picked);
  };

  const send = () => {
    if (!canSend) return;
    const value = text.trim();
    mutate(file ? { text: value, file } : value, {
      onSuccess: () => {
        setText("");
        setFile(null);
      },
    });
  };

  const Icon = file ? KIND_ICONS[fileKind(file.type, file.name)] : null;
  return (
    <div className="flex flex-col gap-2">
      {file && Icon ? (
        <div className="flex w-fit max-w-full items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => setFile(null)}
            disabled={isPending}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={translate("files.remove_attachment")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => input.current?.click()}
          disabled={isPending}
          aria-label={translate("files.attach")}
          title={translate("files.attach")}
        >
          <Paperclip className="size-4" />
        </Button>
        <input
          ref={input}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          aria-label={translate("files.attach")}
          data-testid="message-file-input"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <QuickReplyTextarea
          dealId={dealId}
          value={text}
          onChange={setText}
          onSubmit={send}
          placeholder={translate(
            file ? "files.caption_placeholder" : "crm.messages.placeholder",
          )}
        />
        <Button
          onClick={send}
          disabled={!canSend}
          aria-label={translate("crm.messages.send")}
          className="shrink-0"
        >
          <SendHorizontal className="size-4" />
          {translate("crm.messages.send")}
        </Button>
      </div>
    </div>
  );
};
