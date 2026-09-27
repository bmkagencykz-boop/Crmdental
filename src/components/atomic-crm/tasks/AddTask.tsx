import { Plus } from "lucide-react";
import {
  CreateBase,
  Form,
  useGetIdentity,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { SaveButton } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { Deal } from "../types";
import { TaskFormContent } from "./TaskFormContent";

/** Tomorrow at 10:00, a sensible default for a follow-up call */
const tomorrowMorning = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
};

/**
 * Adds a task to the deal of the record context, or to a deal picked in the
 * form (selectDeal, e.g. from the dashboard).
 */
export const AddTask = ({
  selectDeal,
  display = "chip",
}: {
  selectDeal?: boolean;
  display?: "chip" | "icon";
}) => {
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  const [open, setOpen] = useState(false);
  const handleOpen = () => {
    setOpen(true);
  };

  const handleSuccess = async () => {
    setOpen(false);
    notify("resources.tasks.added");
    // Board and deal counters (no task / overdue) depend on the tasks
    refresh();
  };

  if (!identity) return null;

  return (
    <>
      {display === "icon" ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="p-2 cursor-pointer"
                onClick={handleOpen}
                aria-label={translate("resources.tasks.action.create")}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate("resources.tasks.action.create")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <div className="my-2">
          <Button
            variant="outline"
            className="h-6 cursor-pointer"
            onClick={handleOpen}
            size="sm"
          >
            <Plus className="w-4 h-4" />
            {translate("resources.tasks.action.add")}
          </Button>
        </div>
      )}

      <CreateBase
        resource="tasks"
        record={{
          type: "call",
          deal_id: selectDeal ? undefined : deal?.id,
          due_date: tomorrowMorning(),
          sales_id: (!selectDeal && deal?.sales_id) || identity.id,
        }}
        mutationOptions={{ onSuccess: handleSuccess }}
      >
        <Dialog open={open} onOpenChange={() => setOpen(false)}>
          <DialogContent className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
            <Form className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>
                  {translate("resources.tasks.dialog.create")}
                </DialogTitle>
              </DialogHeader>
              <TaskFormContent selectDeal={selectDeal} />
              <DialogFooter className="w-full justify-end">
                <SaveButton />
              </DialogFooter>
            </Form>
          </DialogContent>
        </Dialog>
      </CreateBase>
    </>
  );
};
