import type {
  DataProvider,
  GetListParams,
  Identifier,
  ResourceCallbacks,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import {
  BULK_ACTIONS,
  distinctIds,
  failure,
  isAllowedAction,
  nextTags,
  type BulkDealResult,
  type BulkDealsAction,
  type BulkDealsResult,
  type BulkParams,
} from "../../deals/list/bulk";
import {
  applyPlanInputs,
  salesPlanReport,
  type SalesPlan,
  type SalesPlanInput,
  type SalesPlanReport,
} from "../../reports/salesPlan";
import type { SavedFilter } from "../../deals/list/dealFilters";
import type { MailingMessage } from "../../mailings/types";
import type {
  Deal,
  DealEvent,
  DealPayment,
  MessageTemplate,
  OrganizationSettings,
  Patient,
  Sale,
  Stage,
} from "../../types";

/**
 * Deal list and sales plan of the demo (stage 21): the same rules as
 * supabase/schemas/21_lists_plans.sql. Bulk actions go through the data
 * provider with the lifecycle callbacks, so the deal "triggers" (lost
 * reason, checklist, log) apply to every deal.
 */
export const createListPlanDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  /** The provider with the lifecycle callbacks (deal triggers) */
  getDataProvider: () => DataProvider;
}) => {
  const me = async () => {
    const salesId = await currentSalesId();
    return (await all<Sale>("sales")).find(
      (sale) => String(sale.id) === String(salesId),
    );
  };
  const isAdmin = (sale?: Sale) =>
    sale?.role === "owner" || sale?.role === "head";

  /** Same as the RLS policy of deals */
  const canSeeDeal = async (deal: Deal) => {
    const sale = await me();
    if (isAdmin(sale)) return true;
    const [settings] = await all<OrganizationSettings>("organization_settings");
    const visibility = settings?.manager_deal_visibility ?? "all";
    if (visibility === "all") return true;
    if (deal.sales_id != null && String(deal.sales_id) === String(sale?.id)) {
      return true;
    }
    return visibility === "own_and_unassigned" && deal.sales_id == null;
  };

  /** Same as the RLS policy of saved_filters */
  const canEditFilter = async (filter: Pick<SavedFilter, "sales_id">) => {
    const sale = await me();
    return filter.sales_id == null
      ? isAdmin(sale)
      : String(filter.sales_id) === String(sale?.id);
  };

  const bulkDeals = async (
    action: BulkDealsAction,
    ids: Identifier[],
    params: BulkParams = {},
  ): Promise<BulkDealsResult> => {
    if (!BULK_ACTIONS.includes(action) || (action as string) === "export") {
      throw new Error(`Неизвестное действие «${action}»`);
    }
    if (!isAllowedAction(action, (await me())?.role)) {
      throw new Error("deal_list.bulk.forbidden");
    }
    const dataProvider = getDataProvider();
    const deals = await all<Deal>("deals");
    const find = (id: Identifier) =>
      deals.find((deal) => String(deal.id) === String(id));
    const stages = await all<Stage>("stages");
    const targetStage =
      action === "stage"
        ? stages.find((stage) => String(stage.id) === String(params.stage_id))
        : undefined;
    if (action === "stage" && !targetStage) throw new Error("Выберите этап");
    if (
      (action === "add_tags" || action === "remove_tags") &&
      !params.tag_ids?.length
    ) {
      throw new Error("Выберите теги");
    }
    if (action === "task" && (!params.text?.trim() || !params.due_date)) {
      throw new Error("Укажите текст и срок задачи");
    }

    const unique = distinctIds(ids);
    const visible: Deal[] = [];
    for (const id of unique) {
      const deal = find(id);
      if (deal && (await canSeeDeal(deal))) visible.push(deal);
    }
    const results: BulkDealResult[] = [];
    let mailingId: Identifier | null = null;

    if (action === "message") {
      const templates = await all<MessageTemplate>("message_templates");
      const template = templates.find(
        (t) => String(t.id) === String(params.template_id),
      );
      const body = params.body?.trim() || template?.body;
      if (!body) throw new Error("Выберите шаблон сообщения");
      if (visible.length) {
        const { data } = await dataProvider.create("mailings", {
          data: {
            name:
              params.name?.trim() || template?.name || "Сообщение по сделкам",
            segment: { deal_ids: visible.map((deal) => deal.id) },
            template_id: template?.id ?? null,
            body,
          },
        });
        mailingId = data.id;
      }
      const queued = (await all<MailingMessage>("mailing_messages")).filter(
        (row) => String(row.mailing_id) === String(mailingId),
      );
      const patients = await all<Patient>("patients");
      for (const id of unique) {
        const deal = visible.find((d) => String(d.id) === String(id));
        if (!deal) {
          results.push(notFound(id));
          continue;
        }
        if (queued.some((row) => String(row.deal_id) === String(id))) {
          results.push({ id, ok: true });
          continue;
        }
        const patient = patients.find(
          (p) => String(p.id) === String(deal.patient_id),
        );
        results.push(
          patient?.messaging_opt_out
            ? {
                id,
                ok: false,
                error: "Пациент отказался от сообщений",
                code: "opted_out",
              }
            : !patient?.phones?.length
              ? {
                  id,
                  ok: false,
                  error: "Нет телефона или чата",
                  code: "no_contact",
                }
              : {
                  id,
                  ok: false,
                  error: "Пациенту уже отправляется сообщение по другой сделке",
                  code: "duplicate",
                },
        );
      }
    } else {
      for (const id of unique) {
        const deal = visible.find((d) => String(d.id) === String(id));
        if (!deal) {
          results.push(notFound(id));
          continue;
        }
        try {
          const update = (data: Partial<Deal>) =>
            dataProvider.update("deals", { id, data, previousData: deal });
          switch (action) {
            case "stage":
              await update({
                stage_id: targetStage!.id,
                pipeline_id: targetStage!.pipeline_id,
                ...(targetStage!.kind === "lost"
                  ? {
                      lost_reason_id:
                        params.lost_reason_id ?? deal.lost_reason_id ?? null,
                      lost_comment:
                        params.lost_comment?.trim() ||
                        deal.lost_comment ||
                        null,
                    }
                  : {}),
              });
              break;
            case "responsible":
              await update({ sales_id: params.sales_id ?? null });
              break;
            case "add_tags":
            case "remove_tags":
              await update({
                tags: nextTags(
                  action,
                  deal.tags ?? [],
                  params.tag_ids ?? [],
                ).map(Number),
              });
              break;
            case "archive":
              await update({
                archived_at: deal.archived_at ?? new Date().toISOString(),
              });
              break;
            case "delete":
              await dataProvider.delete("deals", { id, previousData: deal });
              break;
            case "task":
              await dataProvider.create("tasks", {
                data: {
                  deal_id: id,
                  type: params.type || "call",
                  text: params.text!.trim(),
                  due_date: params.due_date,
                  done_date: null,
                  sales_id: params.sales_id ?? deal.sales_id ?? null,
                },
              });
              break;
          }
          results.push({ id, ok: true });
        } catch (error) {
          results.push(failure(id, error));
        }
      }
    }
    return {
      action,
      results,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      mailing_id: mailingId,
    };
  };

  const planData = async () => {
    const [deals, stages, deal_events, deal_payments, sales, sales_plans] =
      await Promise.all([
        all<Deal>("deals"),
        all<Stage>("stages"),
        all<DealEvent>("deal_events"),
        all<DealPayment>("deal_payments"),
        all<Sale>("sales"),
        all<SalesPlan>("sales_plans"),
      ]);
    return { deals, stages, deal_events, deal_payments, sales, sales_plans };
  };

  const checkPlanAccess = async () => {
    if (!isAdmin(await me())) throw new Error("reports.forbidden");
  };

  const methods = {
    bulkDeals,
    getSalesPlanReport: async (
      month?: string | null,
    ): Promise<SalesPlanReport> => {
      await checkPlanAccess();
      return salesPlanReport(await planData(), month);
    },
    saveSalesPlan: async (
      month: string,
      plans: SalesPlanInput[],
    ): Promise<number> => {
      await checkPlanAccess();
      const { upsert, remove } = applyPlanInputs(
        await all<SalesPlan>("sales_plans"),
        month,
        plans,
      );
      for (const row of remove) {
        await baseDataProvider.delete("sales_plans", {
          id: row.id!,
          previousData: row as SalesPlan & { id: Identifier },
        });
      }
      for (const row of upsert) {
        const data = { ...row, updated_at: new Date().toISOString() };
        if (row.id != null) {
          await baseDataProvider.update("sales_plans", {
            id: row.id,
            data,
            previousData: row,
          });
        } else {
          await baseDataProvider.create("sales_plans", { data });
        }
      }
      return upsert.length;
    },
  };

  /** Same as the RLS policy: clinic-wide filters and my own */
  const listSavedFilters = async (params: GetListParams) => {
    const salesId = await currentSalesId();
    const visible = (await all<SavedFilter>("saved_filters")).filter(
      (filter) =>
        filter.sales_id == null || String(filter.sales_id) === String(salesId),
    );
    return fakeRestDataProvider({ saved_filters: visible }, false, 0).getList(
      "saved_filters",
      params,
    );
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "saved_filters",
      beforeCreate: async (params) => {
        const data: Record<string, any> = {
          resource: "deals",
          filter: {},
          position: 0,
          ...params.data,
          sales_id:
            params.data.sales_id === undefined
              ? ((await currentSalesId()) ?? null)
              : params.data.sales_id,
          created_at: new Date().toISOString(),
        };
        if (!String(data.name ?? "").trim()) {
          throw new Error("deal_list.saved.errors.name");
        }
        if (!(await canEditFilter(data as SavedFilter))) {
          throw new Error("deal_list.saved.errors.forbidden");
        }
        return { ...params, data };
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<SavedFilter>(
          "saved_filters",
          { id: params.id },
        );
        if (
          !(await canEditFilter(previous)) ||
          !(await canEditFilter({ ...previous, ...params.data }))
        ) {
          throw new Error("deal_list.saved.errors.forbidden");
        }
        return params;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<SavedFilter>(
          "saved_filters",
          { id: params.id },
        );
        if (!(await canEditFilter(previous))) {
          throw new Error("deal_list.saved.errors.forbidden");
        }
        return params;
      },
    },
  ];

  return { methods, callbacks, listSavedFilters };
};

const notFound = (id: Identifier): BulkDealResult => ({
  id,
  ok: false,
  error: "Сделка не найдена или нет доступа",
  code: "not_found",
});
