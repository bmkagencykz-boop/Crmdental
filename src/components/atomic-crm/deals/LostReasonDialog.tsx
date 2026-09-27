import { useState } from "react";
import type { Identifier } from "ra-core";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useLostReasons } from "../dictionaries/useDictionaries";

/**
 * Asked when a deal moves to a lost stage: the reason is mandatory (spec).
 */
export const LostReasonDialog = ({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reasonId: Identifier, comment: string) => void;
}) => {
  const translate = useTranslate();
  const { data: reasons } = useLostReasons();
  const [reasonId, setReasonId] = useState<Identifier | null>(null);
  const [comment, setComment] = useState("");

  const close = () => {
    setReasonId(null);
    setComment("");
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{translate("crm.deals.lost.title")}</DialogTitle>
          <DialogDescription>
            {translate("crm.deals.lost.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {reasons
            .filter((reason) => !reason.is_archived)
            .map((reason) => (
              <button
                key={reason.id}
                type="button"
                role="radio"
                aria-checked={reasonId === reason.id}
                onClick={() => setReasonId(reason.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  reasonId === reason.id
                    ? "bg-primary text-primary-foreground"
                    : "soft hover:bg-card",
                )}
              >
                {reason.name}
              </button>
            ))}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="lost_comment">
            {translate("crm.deals.lost.comment")}
          </Label>
          <Textarea
            id="lost_comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            disabled={reasonId == null}
            onClick={() => {
              if (reasonId == null) return;
              onConfirm(reasonId, comment);
              setReasonId(null);
              setComment("");
            }}
          >
            {translate("crm.deals.lost.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
