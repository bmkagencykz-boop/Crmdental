import { DragDropContext, type OnDragEndResponder } from "@hello-pangea/dnd";
import {
  useDataProvider,
  useListContext,
  useNotify,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";

import { getPipelineStages, useStages } from "../dictionaries/useDictionaries";
import type { Deal } from "../types";
import { DealColumn } from "./DealColumn";
import { LostReasonDialog } from "./LostReasonDialog";
import { getDealsByStage, type DealsByStage } from "./stages";

type PendingMove = {
  deal: Deal;
  from: { stageId: string; index: number };
  to: { stageId: string; index: number };
};

/**
 * Kanban of one pipeline: a column per stage, deals dragged between stages.
 * Moving to a lost stage asks for the reason first.
 */
export const DealListContent = ({ pipelineId }: { pipelineId: Identifier }) => {
  const { data: allStages } = useStages();
  const stages = useMemo(
    () => getPipelineStages(allStages, pipelineId),
    [allStages, pipelineId],
  );
  const { data: deals, isPending, refetch } = useListContext<Deal>();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const [dealsByStage, setDealsByStage] = useState<DealsByStage>({});
  const [pendingLost, setPendingLost] = useState<PendingMove | null>(null);

  useEffect(() => {
    setDealsByStage(getDealsByStage(deals ?? [], stages));
  }, [deals, stages]);

  if (isPending) return null;

  const persist = async (
    move: PendingMove,
    extra: Partial<Deal> = {},
  ): Promise<void> => {
    const next = moveLocally(dealsByStage, move);
    setDealsByStage(next);
    try {
      // The stage change first: the database may refuse it (lost deals are locked)
      await dataProvider.update("deals", {
        id: move.deal.id,
        data: {
          stage_id: Number(move.to.stageId),
          index: move.to.index,
          ...extra,
        },
        previousData: move.deal,
      });
      // Then renumber the touched columns
      const touched = new Set([move.from.stageId, move.to.stageId]);
      await Promise.all(
        [...touched].flatMap((stageId) =>
          (next[stageId] ?? [])
            .map((deal, index) => ({ deal, index }))
            .filter(
              ({ deal, index }) =>
                deal.id !== move.deal.id && deal.index !== index,
            )
            .map(({ deal, index }) =>
              dataProvider.update("deals", {
                id: deal.id,
                data: { index },
                previousData: deal,
              }),
            ),
        ),
      );
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      refetch();
    }
  };

  const onDragEnd: OnDragEndResponder = ({ source, destination }) => {
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }
    const deal = dealsByStage[source.droppableId]?.[source.index];
    if (!deal) return;
    const move: PendingMove = {
      deal,
      from: { stageId: source.droppableId, index: source.index },
      to: { stageId: destination.droppableId, index: destination.index },
    };
    const target = stages.find(
      (stage) => String(stage.id) === destination.droppableId,
    );
    if (
      target?.kind === "lost" &&
      source.droppableId !== destination.droppableId
    ) {
      setPendingLost(move);
      return;
    }
    persist(move);
  };

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="-mx-8 overflow-x-auto px-8 pb-4">
          <div className="flex w-max gap-4">
            {stages.map((stage, index) => (
              <DealColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage[String(stage.id)] ?? []}
                isFirst={index === 0}
              />
            ))}
          </div>
        </div>
      </DragDropContext>
      <LostReasonDialog
        open={pendingLost != null}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reasonId, comment) => {
          if (!pendingLost) return;
          persist(pendingLost, {
            lost_reason_id: reasonId,
            lost_comment: comment || null,
          });
          setPendingLost(null);
        }}
      />
    </>
  );
};

/** Board state after moving a deal, before the server answers */
export const moveLocally = (
  dealsByStage: DealsByStage,
  { deal, from, to }: PendingMove,
): DealsByStage => {
  const next: DealsByStage = { ...dealsByStage };
  const source = [...(next[from.stageId] ?? [])];
  source.splice(from.index, 1);
  next[from.stageId] = source;
  const target =
    from.stageId === to.stageId ? source : [...(next[to.stageId] ?? [])];
  target.splice(to.index, 0, { ...deal, stage_id: Number(to.stageId) });
  next[to.stageId] = target;
  return next;
};
