import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import { bulkPrice, categoryPath } from "../../price-list/priceListMath";
import type {
  BulkServiceAction,
  BulkServiceResult,
  NewService,
  PriceHistoryRow,
  PriceListRow,
  ServiceCategory,
  ServiceCost,
} from "../../price-list/types";
import type { Sale, Service } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);
const nowIso = () => new Date().toISOString();
const clean = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ");
const nameKey = (value: string | null | undefined) =>
  clean(value).toLowerCase();

const fail = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

type Row = Record<string, unknown>;

/**
 * The price list of the demo (stage 35): the same rules as
 * supabase/schemas/35_price_list.sql — the category tree (two levels,
 * unique names among siblings, no «/»), services.category kept equal to the
 * path of category_id (and a path creating its categories), the price
 * history, the cost price for the owner and the head only, the bulk actions
 * (price rounded to 100 ₸, delete vs archive of used services) and the
 * rights: the owner, the head and the integrator edit, everybody reads.
 */
export const createPriceListDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    // The demo's default user (no staff row) is the owner
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const checkEditor = async () => {
    if (!["owner", "head", "integrator"].includes(await myRole())) {
      throw fail("Прайс меняют владелец и руководитель клиники", "42501");
    }
  };
  const seesCost = async () => ["owner", "head"].includes(await myRole());

  const categories = () => all<ServiceCategory>("service_categories");
  const services = () => all<Service>("services");

  /** Same as private.resolve_service_category */
  const resolveCategory = async (path: string | null | undefined) => {
    const parts = (path ?? "")
      .split(/[/>→]/)
      .map(clean)
      .filter(Boolean)
      .slice(0, 2);
    let parent: Identifier | null = null;
    for (const part of parts) {
      const list = await categories();
      const found = list.find(
        (c) =>
          (parent == null ? c.parent_id == null : same(c.parent_id, parent)) &&
          nameKey(c.name) === part.toLowerCase(),
      );
      if (found) {
        parent = found.id;
        continue;
      }
      const siblings = list.filter((c) =>
        parent == null ? c.parent_id == null : same(c.parent_id, parent),
      );
      const created: { data: ServiceCategory } =
        await baseDataProvider.create<ServiceCategory>("service_categories", {
          data: {
            parent_id: parent,
            name: part.slice(0, 100),
            position:
              siblings.reduce((max, c) => Math.max(max, c.position), -1) + 1,
            created_at: nowIso(),
          },
        });
      parent = created.data.id;
    }
    return parent;
  };

  /** Same as private.handle_service_category */
  const syncCategory = async (next: Row, previous?: Service) => {
    if (next.specialty !== undefined) {
      next.specialty = clean(next.specialty as string) || null;
    }
    if (next.materials_note !== undefined) {
      next.materials_note =
        ((next.materials_note as string | null) ?? "").trim() || null;
    }
    const merged = { ...(previous ?? {}), ...next } as Service;
    const list = await categories();
    const categoryChanged =
      !previous || !sameOrNull(merged.category_id, previous.category_id);
    if (categoryChanged && merged.category_id != null) {
      const path = categoryPath(list, merged.category_id);
      if (path == null) throw fail("Раздел прайса не найден", "23503");
      next.category = path;
    } else if (
      categoryChanged &&
      clean(merged.category) &&
      (!previous || merged.category !== previous.category)
    ) {
      next.category_id = await resolveCategory(merged.category);
      next.category = categoryPath(
        await categories(),
        next.category_id as Identifier,
      );
    } else if (categoryChanged) {
      next.category = null;
    } else if (previous && merged.category !== previous.category) {
      if (!clean(merged.category)) {
        next.category_id = null;
        next.category = null;
      } else if (
        merged.category_id == null ||
        merged.category !== categoryPath(list, merged.category_id)
      ) {
        next.category_id = await resolveCategory(merged.category);
        next.category = categoryPath(
          await categories(),
          next.category_id as Identifier,
        );
      }
    }
  };

  const addHistory = async (
    serviceId: Identifier,
    oldPrice: number | null,
    newPrice: number | null,
  ) =>
    baseDataProvider.create("service_price_history", {
      data: {
        service_id: serviceId,
        old_price: oldPrice,
        new_price: newPrice,
        sales_id: (await currentSalesId()) ?? null,
        changed_at: nowIso(),
      },
    });

  /** Same as private.service_in_use */
  const usedServiceIds = async () => {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      if (value != null) ids.add(String(value));
    };
    for (const resource of [
      "deals",
      "visits",
      "treatment_plan_items",
      "stage_triggers",
    ]) {
      for (const row of await all<Row>(resource)) add(row.service_id);
    }
    for (const row of await all<Row>("recall_rules")) {
      add(row.service_id);
      add(row.deal_service_id);
    }
    return ids;
  };

  const previousServices = new Map<string, Service>();
  const previousCategories = new Map<string, ServiceCategory>();

  /** Same as the trigger handle_service_category_after_update */
  const rewritePaths = async (categoryId: Identifier) => {
    const list = await categories();
    const ids = new Set(
      list
        .filter((c) => same(c.id, categoryId) || same(c.parent_id, categoryId))
        .map((c) => String(c.id)),
    );
    for (const service of await services()) {
      if (service.category_id == null || !ids.has(String(service.category_id)))
        continue;
      const path = categoryPath(list, service.category_id);
      if (path !== service.category) {
        await baseDataProvider.update("services", {
          id: service.id,
          data: { category: path },
          previousData: service,
        });
      }
    }
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "services",
      beforeCreate: async (params) => {
        await checkEditor();
        const data = { unit: "service", ...params.data } as Row;
        await syncCategory(data);
        return { ...params, data };
      },
      afterCreate: async (result) => {
        const service = result.data as Service;
        if (service.price != null) {
          await addHistory(service.id, null, service.price);
        }
        return result;
      },
      beforeUpdate: async (params) => {
        await checkEditor();
        const previous = (await services()).find((s) => same(s.id, params.id));
        if (!previous) throw fail("Услуга не найдена", "P0002");
        const data = { ...params.data } as Row;
        for (const column of ["cost_price", "in_use", "price_changed_at"]) {
          delete data[column];
        }
        await syncCategory(data, previous);
        previousServices.set(String(params.id), previous);
        return { ...params, data };
      },
      afterUpdate: async (result) => {
        const service = result.data as Service;
        const previous = previousServices.get(String(service.id));
        previousServices.delete(String(service.id));
        if (previous && (previous.price ?? null) !== (service.price ?? null)) {
          await addHistory(
            service.id,
            previous.price ?? null,
            service.price ?? null,
          );
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkEditor();
        return params;
      },
      afterDelete: async (result) => {
        const id = result.data?.id;
        for (const resource of ["service_costs", "service_price_history"]) {
          for (const row of await all<Row & { id: Identifier }>(resource)) {
            if (same(row.service_id as Identifier, id)) {
              await baseDataProvider.delete(resource, { id: row.id });
            }
          }
        }
        return result;
      },
    },
    {
      resource: "service_categories",
      beforeCreate: async (params) => {
        await checkEditor();
        const data = {
          position: 0,
          parent_id: null,
          created_at: nowIso(),
          ...params.data,
        } as unknown as ServiceCategory;
        await checkCategory(data);
        return { ...params, data };
      },
      beforeUpdate: async (params) => {
        await checkEditor();
        const previous = (await categories()).find((c) =>
          same(c.id, params.id),
        );
        if (!previous) throw fail("Раздел прайса не найден", "P0002");
        const data = { ...previous, ...params.data } as ServiceCategory;
        await checkCategory(data, previous);
        previousCategories.set(String(params.id), previous);
        return { ...params, data: { ...params.data, name: data.name } };
      },
      afterUpdate: async (result) => {
        const category = result.data as ServiceCategory;
        const previous = previousCategories.get(String(category.id));
        previousCategories.delete(String(category.id));
        if (
          previous &&
          (previous.name !== category.name ||
            !sameOrNull(previous.parent_id, category.parent_id))
        ) {
          await rewritePaths(category.id);
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkEditor();
        const list = await categories();
        const category = list.find((c) => same(c.id, params.id));
        if (category) {
          // Same as handle_service_category_delete: the services of a
          // subsection go to its section, those of a section lose it
          const target = category.parent_id ?? null;
          const ids = new Set(
            list
              .filter(
                (c) =>
                  same(c.id, category.id) || same(c.parent_id, category.id),
              )
              .map((c) => String(c.id)),
          );
          for (const service of await services()) {
            if (
              service.category_id != null &&
              ids.has(String(service.category_id))
            ) {
              await baseDataProvider.update("services", {
                id: service.id,
                data: {
                  category_id: target,
                  category: target == null ? null : categoryPath(list, target),
                },
                previousData: service,
              });
            }
          }
          // The subsections go with their section (on delete cascade)
          for (const child of list.filter((c) =>
            same(c.parent_id, category.id),
          )) {
            await baseDataProvider.delete("service_categories", {
              id: child.id,
              previousData: child,
            });
          }
        }
        return params;
      },
    },
  ];

  /** Same as the constraints and handle_service_category_before_write */
  const checkCategory = async (
    data: ServiceCategory,
    previous?: ServiceCategory,
  ) => {
    data.name = clean(data.name);
    if (!data.name) throw fail("Укажите название раздела", "23514");
    if (data.name.includes("/") || data.name.length > 100) {
      throw fail("Название раздела без «/», до 100 символов", "23514");
    }
    const list = await categories();
    if (
      data.parent_id != null &&
      (!previous || !sameOrNull(data.parent_id, previous.parent_id))
    ) {
      const parent = list.find((c) => same(c.id, data.parent_id));
      if (!parent) throw fail("Раздел прайса не найден", "23503");
      if (parent.parent_id != null || same(parent.id, previous?.id)) {
        throw fail("В прайсе два уровня: раздел и подраздел", "22023");
      }
      if (previous && list.some((c) => same(c.parent_id, previous.id))) {
        throw fail("Раздел с подразделами не может стать подразделом", "22023");
      }
    }
    if (
      list.some(
        (c) =>
          !same(c.id, previous?.id) &&
          sameOrNull(c.parent_id, data.parent_id) &&
          nameKey(c.name) === nameKey(data.name),
      )
    ) {
      throw fail("Такой раздел уже есть", "23505");
    }
  };

  const costs = async () =>
    (await seesCost()) ? all<ServiceCost>("service_costs") : [];

  /** Same as the view public.price_list */
  const priceListView = async (): Promise<PriceListRow[]> => {
    const [list, costRows, history, used] = await Promise.all([
      services(),
      costs(),
      all<PriceHistoryRow>("service_price_history"),
      usedServiceIds(),
    ]);
    return list.map((service) => {
      const changes = history.filter((h) => same(h.service_id, service.id));
      return {
        ...service,
        unit: service.unit ?? "service",
        cost_price:
          costRows.find((c) => same(c.service_id, service.id))?.cost_price ??
          null,
        in_use: used.has(String(service.id)),
        price_changed_at: changes.length
          ? changes
              .map((h) => h.changed_at)
              .sort()
              .at(-1)!
          : null,
      };
    });
  };

  const methods = {
    /** Same as public.bulk_services */
    async bulkServices(
      ids: Identifier[],
      action: BulkServiceAction,
      options: { amount?: number | null; categoryId?: Identifier | null } = {},
    ): Promise<BulkServiceResult> {
      await checkEditor();
      const result: BulkServiceResult = { updated: 0, deleted: 0, archived: 0 };
      const wanted = new Set(ids.map(String));
      const targets = (await services()).filter((s) =>
        wanted.has(String(s.id)),
      );
      const write = async (service: Service, data: Partial<Service>) => {
        await baseDataProvider.update("services", {
          id: service.id,
          data,
          previousData: service,
        });
        result.updated++;
      };
      if (action === "move") {
        const target = options.categoryId ?? null;
        const list = await categories();
        if (target != null && !list.some((c) => same(c.id, target))) {
          throw fail("Раздел прайса не найден", "23503");
        }
        for (const service of targets) {
          if (sameOrNull(service.category_id, target)) continue;
          await write(service, {
            category_id: target,
            category: target == null ? null : categoryPath(list, target),
          });
        }
      } else if (action === "price_percent" || action === "price_amount") {
        const amount = options.amount;
        if (
          amount == null ||
          (action === "price_percent" && (amount <= -100 || amount > 1000))
        ) {
          throw fail("Неверное изменение цены", "22023");
        }
        for (const service of targets) {
          if (service.price == null) continue;
          const price = bulkPrice(service.price, action, amount);
          if (price === service.price) continue;
          await write(service, { price });
          await addHistory(service.id, service.price, price);
        }
      } else if (action === "archive" || action === "restore") {
        for (const service of targets) {
          if (service.is_archived === (action === "archive")) continue;
          await write(service, { is_archived: action === "archive" });
        }
      } else if (action === "delete") {
        const used = await usedServiceIds();
        for (const service of targets) {
          if (used.has(String(service.id))) {
            if (!service.is_archived) {
              await baseDataProvider.update("services", {
                id: service.id,
                data: { is_archived: true },
                previousData: service,
              });
              result.archived++;
            }
          } else {
            await baseDataProvider.delete("services", {
              id: service.id,
              previousData: service,
            });
            for (const resource of ["service_costs", "service_price_history"]) {
              for (const row of await all<Row & { id: Identifier }>(resource)) {
                if (same(row.service_id as Identifier, service.id)) {
                  await baseDataProvider.delete(resource, { id: row.id });
                }
              }
            }
            result.deleted++;
          }
        }
      } else {
        throw fail(`Неизвестное действие: ${action}`, "22023");
      }
      return result;
    },
    /** Same as public.set_service_cost */
    async setServiceCost(
      serviceId: Identifier,
      cost: number | null,
    ): Promise<void> {
      if (!(await seesCost())) {
        throw fail(
          "Себестоимость видят и меняют только владелец и руководитель",
          "42501",
        );
      }
      if (!(await services()).some((s) => same(s.id, serviceId))) {
        throw fail("Услуга не найдена", "P0002");
      }
      if (cost != null && cost < 0) {
        throw fail("Себестоимость не может быть отрицательной", "23514");
      }
      const existing = (await all<ServiceCost>("service_costs")).find((c) =>
        same(c.service_id, serviceId),
      );
      if (cost == null) {
        if (existing) {
          await baseDataProvider.delete("service_costs", { id: existing.id });
        }
        return;
      }
      const data = {
        service_id: serviceId,
        cost_price: cost,
        updated_by: (await currentSalesId()) ?? null,
        updated_at: nowIso(),
      };
      if (existing) {
        await baseDataProvider.update("service_costs", {
          id: existing.id,
          data,
          previousData: existing,
        });
      } else {
        await baseDataProvider.create("service_costs", { data });
      }
    },
    /** Several services in order (through the callbacks of «services») */
    async createServices(rows: NewService[]): Promise<Identifier[]> {
      const ids: Identifier[] = [];
      for (const row of rows) {
        const data = { is_archived: false, ...row } as Row;
        await checkEditor();
        await syncCategory(data);
        const { data: created } = await baseDataProvider.create<Service>(
          "services",
          { data: { unit: "service", ...data } },
        );
        if (created.price != null) {
          await addHistory(created.id, null, created.price);
        }
        ids.push(created.id);
      }
      return ids;
    },
  };

  const views = {
    price_list: priceListView,
    // RLS: the cost price for the owner and the head only
    service_costs: costs,
  };

  return { methods, callbacks, views };
};

const sameOrNull = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => (a == null ? b == null : b != null && String(a) === String(b));
