import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import {
  useDeleteWithUndoController,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useState } from "react";
import { ReferenceField } from "@/components/admin/reference-field";
import { DateField } from "@/components/admin/date-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Link } from "react-router";
import { patientDisplayName } from "../patients/parsePatientText";
import type { Deal, Task as TData } from "../types";
import { useGetSalesName } from "../sales/useGetSalesName";
import { AutomessageSendButton } from "./AutomessageSendButton";
import { TaskEdit } from "./TaskEdit";
import { isOverdue } from "./tasksPredicate";

export const Task = ({
  task,
  showDeal,
  showResponsible,
}: {
  task: TData;
  /** Show the patient and deal the task is about (dashboard lists) */
  showDeal?: boolean;
  /** Show who the task is assigned to (tasks of the whole team) */
  showResponsible?: boolean;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();

  const [openEdit, setOpenEdit] = useState(false);

  const handleCloseEdit = () => {
    setOpenEdit(false);
  };

  const [update, { isPending: isUpdatePending, isSuccess, variables }] =
    useUpdate();
  const { handleDelete } = useDeleteWithUndoController({
    record: task,
    redirect: false,
    mutationOptions: {
      onSuccess() {
        notify("resources.tasks.deleted", {
          undoable: true,
        });
      },
    },
  });

  const handleEdit = () => {
    setOpenEdit(true);
  };

  const handleCheck = () => () => {
    update("tasks", {
      id: task.id,
      data: {
        done_date: task.done_date ? null : new Date().toISOString(),
      },
      previousData: task,
    });
  };

  useEffect(() => {
    // We do not want to invalidate the query when a tack is checked or unchecked
    if (
      isUpdatePending ||
      !isSuccess ||
      variables?.data?.done_date != undefined
    ) {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] });
  }, [queryClient, isUpdatePending, isSuccess, variables]);

  const responsible = useGetSalesName(task.sales_id, {
    enabled: !!showResponsible && task.sales_id != null,
  });
  const overdue = !task.done_date && isOverdue(task.due_date);
  const labelId = `checkbox-list-label-${task.id}`;

  return (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 flex-1">
          <Checkbox
            id={labelId}
            checked={!!task.done_date}
            onCheckedChange={handleCheck()}
            disabled={isUpdatePending}
            className="mt-1"
          />
          <div className={`flex-grow ${task.done_date ? "line-through" : ""}`}>
            <div className="text-sm">
              {task.type && (
                <>
                  <span className="font-semibold text-sm">
                    {translate(`crm.tasks.types.${task.type}`)}
                  </span>
                  &nbsp;
                </>
              )}
              <span className="whitespace-pre-line">{task.text}</span>
            </div>
            <AutomessageSendButton task={task} />
            <div className="text-sm text-muted-foreground">
              <span className={overdue ? "font-medium text-brand-red" : ""}>
                {translate("resources.tasks.fields.due_short")}
                &nbsp;
                <DateField
                  source="due_date"
                  record={task}
                  showDate
                  showTime
                  options={{
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }}
                />
              </span>
              {showResponsible && responsible ? ` · ${responsible}` : null}
              {showDeal && (
                <ReferenceField<TData, Deal>
                  source="deal_id"
                  reference="deals"
                  record={task}
                  link={false}
                  className="inline text-sm text-muted-foreground"
                  render={({ referenceRecord }) => {
                    if (!referenceRecord) return null;
                    return (
                      <>
                        {" · "}
                        <Link
                          to={`/deals/${referenceRecord.id}/show`}
                          className="text-brand-link hover:underline"
                        >
                          {patientDisplayName({
                            last_name: referenceRecord.patient_last_name,
                            first_name: referenceRecord.patient_first_name,
                          })}
                        </Link>
                      </>
                    );
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 pr-0! size-8 cursor-pointer"
              aria-label={translate("resources.tasks.actions.title")}
            >
              <MoreVertical className="size-5 md:size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: postpone(1),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_tomorrow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: postpone(7),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_next_week")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleEdit}
            >
              {translate("ra.action.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleDelete}
            >
              {translate("ra.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <TaskEdit taskId={task.id} open={openEdit} close={handleCloseEdit} />
    </>
  );
};

/** Same time of day, n days later */
const postpone = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
