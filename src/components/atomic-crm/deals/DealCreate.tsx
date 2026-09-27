import {
  Form,
  useDataProvider,
  useGetIdentity,
  useListContext,
  useRedirect,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useSearchParams } from "react-router";
import { Create } from "@/components/admin/create";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import {
  findById,
  getPipelineStages,
  useStages,
} from "../dictionaries/useDictionaries";
import type { Deal } from "../types";
import { DealInputs } from "./DealInputs";

export const DealCreate = ({
  open,
  pipelineId,
}: {
  open: boolean;
  pipelineId: Identifier;
}) => {
  const redirect = useRedirect();
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const { data: allDeals, refetch } = useListContext<Deal>();
  const { identity } = useGetIdentity();
  const { data: allStages } = useStages();
  const [searchParams] = useSearchParams();
  const stages = getPipelineStages(allStages, pipelineId);
  const stage =
    findById(stages, searchParams.get("stage_id")) ?? stages[0] ?? undefined;

  const handleClose = () => redirect("/deals");

  // New deals go on top of their column
  const onSuccess = async (deal: Deal) => {
    const below = (allDeals ?? []).filter(
      (d) => d.stage_id === deal.stage_id && d.id !== deal.id,
    );
    await Promise.all(
      below.map((d) =>
        dataProvider.update("deals", {
          id: d.id,
          data: { index: d.index + 1 },
          previousData: d,
        }),
      ),
    );
    refetch();
    redirect(`/deals/${deal.id}/show`);
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-3xl">
        <DialogTitle className="text-xl font-bold">
          {translate("resources.deals.action.new")}
        </DialogTitle>
        <Create resource="deals" mutationOptions={{ onSuccess }} title={false}>
          <Form
            defaultValues={{
              pipeline_id: pipelineId,
              patient_id: searchParams.get("patient_id")
                ? Number(searchParams.get("patient_id"))
                : undefined,
              stage_id: stage?.id,
              sales_id: identity?.id,
              plan_amount: 0,
              tags: [],
              index: 0,
            }}
          >
            <DealInputs />
            <FormToolbar>
              <SaveButton />
            </FormToolbar>
          </Form>
        </Create>
      </DialogContent>
    </Dialog>
  );
};
