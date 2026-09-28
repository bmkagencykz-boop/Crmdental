import {
  CanAccess,
  EditBase,
  Form,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { Link } from "react-router";
import { DeleteButton } from "@/components/admin/delete-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { FormToolbar } from "../layout/FormToolbar";
import { RecordReady } from "../misc/RecordReady";
import type { Deal } from "../types";
import { DealInputs } from "./DealInputs";

export const DealEdit = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const notify = useNotify();

  const handleClose = () => {
    redirect("/deals", undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-3xl">
        {id ? (
          <EditBase
            id={id}
            mutationMode="pessimistic"
            mutationOptions={{
              onSuccess: () => {
                notify("resources.deals.updated", {});
                redirect(`/deals/${id}/show`, undefined, undefined, undefined, {
                  _scrollToTop: false,
                });
              },
              onError: (error: any) => {
                notify(error?.message || "ra.notification.http_error", {
                  type: "error",
                });
              },
            }}
          >
            <EditHeader />
            <RecordReady>
              <Form>
                <DealInputs />
                <FormToolbar />
              </Form>
            </RecordReady>
          </EditBase>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

function EditHeader() {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  if (!deal) {
    return (
      <DialogTitle className="sr-only">
        {translate("resources.deals.action.edit")}
      </DialogTitle>
    );
  }

  return (
    <DialogTitle className="pb-0">
      <div className="mb-6 flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold">
          {translate("resources.deals.action.edit")}
        </h2>
        <div className="flex gap-2 pr-10">
          <CanAccess resource="deals" action="delete" record={deal}>
            <DeleteButton />
          </CanAccess>
          <Button asChild variant="outline">
            <Link to={`/deals/${deal.id}/show`}>
              {translate("resources.deals.action.back_to_deal")}
            </Link>
          </Button>
        </div>
      </div>
    </DialogTitle>
  );
}
