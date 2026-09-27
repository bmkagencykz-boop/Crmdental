import { Plus, Tag as TagIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  useGetMany,
  useListContext,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TagForm } from "../tags/TagForm";
import { useCreateTag } from "../tags/useCreateTag";
import { useTags } from "../tags/useTags";
import type { Patient, Tag } from "../types";

type BulkTagDialogMode = "select" | "create";

export function BulkTagButton() {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [update] = useUpdate<Patient>("patients", undefined, {
    returnPromise: true,
  });
  const createTag = useCreateTag();
  const { onUnselectItems, selectedIds = [] } = useListContext<Patient>();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BulkTagDialogMode>("select");
  const [isApplying, setIsApplying] = useState(false);

  const { data: selectedPatients = [], isPending: isPendingPatients } =
    useGetMany<Patient>(
      "patients",
      { ids: selectedIds },
      { enabled: open && selectedIds.length > 0 },
    );
  const { data: tags = [], isPending: isPendingTags } = useTags({
    enabled: open,
  });

  const closeDialog = useCallback(() => {
    setOpen(false);
    setMode("select");
  }, []);

  useEffect(() => {
    if (!selectedIds.length && open) {
      closeDialog();
    }
  }, [closeDialog, open, selectedIds.length]);

  const applyTagToSelection = useCallback(
    async (tag: Tag) => {
      const patientsToUpdate = selectedPatients.filter(
        (patient) => !patient.tags.includes(tag.id),
      );

      setIsApplying(true);

      try {
        await Promise.all(
          patientsToUpdate.map((patient) =>
            update("patients", {
              id: patient.id,
              data: { tags: [...(patient.tags ?? []), tag.id] },
              previousData: patient,
            }),
          ),
        );

        notify(
          patientsToUpdate.length > 0
            ? "resources.patients.bulk_tag.success"
            : "resources.patients.bulk_tag.noop",
          {
            messageArgs: { smart_count: patientsToUpdate.length },
            type: "success",
          },
        );
        closeDialog();
        onUnselectItems();
        refresh();
      } catch (error) {
        notify("resources.patients.bulk_tag.error", {
          type: "error",
        });
        console.error("Bulk tag failed:", error);
      } finally {
        setIsApplying(false);
      }
    },
    [closeDialog, update, notify, onUnselectItems, refresh, selectedPatients],
  );

  const handleCreateTag = async (data: Pick<Tag, "name" | "color">) => {
    const tag = await createTag(data);
    await applyTagToSelection(tag);
  };

  if (!selectedIds.length) {
    return null;
  }

  const isBusy = isApplying || isPendingPatients || isPendingTags;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => setOpen(true)}
      >
        <TagIcon />
        {translate("resources.patients.bulk_tag.action")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            closeDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {mode === "select" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {translate("resources.patients.bulk_tag.title")}
                </DialogTitle>
                <DialogDescription>
                  {translate("resources.patients.bulk_tag.description")}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col space-y-2 items-start">
                {isPendingTags ? (
                  <p className="text-sm text-muted-foreground">
                    {translate("crm.common.loading")}
                  </p>
                ) : tags.length > 0 ? (
                  tags.map((tag) => (
                    <Button
                      key={tag.id}
                      type="button"
                      variant="ghost"
                      disabled={isBusy}
                      className="px-0 py-0 hover:bg-default dark:hover:bg-default mb-0"
                      onClick={() => applyTagToSelection(tag)}
                    >
                      <Badge
                        variant="secondary"
                        className="font-normal text-black cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </Badge>
                    </Button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {translate("resources.patients.bulk_tag.empty")}
                  </p>
                )}
              </div>

              <div className="flex justify-start">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => setMode("create")}
                >
                  <Plus />
                  {translate("resources.tags.action.create")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {translate("resources.tags.dialog.create_title")}
                </DialogTitle>
                <DialogDescription>
                  {translate("resources.patients.bulk_tag.create_description")}
                </DialogDescription>
              </DialogHeader>

              <TagForm
                cancelLabel={translate("resources.patients.bulk_tag.back")}
                open={open && mode === "create"}
                onCancel={() => setMode("select")}
                onSubmit={handleCreateTag}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
