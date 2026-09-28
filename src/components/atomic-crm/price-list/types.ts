import type { Identifier } from "ra-core";

import type { Service } from "../types";

/** A section (parent_id null) or a subsection of the price list */
export type ServiceCategory = {
  id: Identifier;
  parent_id: Identifier | null;
  name: string;
  position: number;
};

/** A row of the view public.price_list */
export type PriceListRow = Service & {
  /** Null where the employee may not see it (managers, integrator) */
  cost_price?: number | null;
  /** Used by deals, visits, plans, recall rules or stage triggers */
  in_use?: boolean;
  price_changed_at?: string | null;
};

/** A row of public.service_price_history */
export type PriceHistoryRow = {
  id: Identifier;
  service_id: Identifier;
  old_price: number | null;
  new_price: number | null;
  sales_id: Identifier | null;
  changed_at: string;
};

export type BulkServiceAction =
  | "move"
  | "price_percent"
  | "price_amount"
  | "archive"
  | "restore"
  | "delete";

export type BulkServiceResult = {
  updated: number;
  deleted: number;
  archived: number;
};

/** A service to create (import, starter price list) */
export type NewService = {
  name: string;
  code?: string | null;
  /** The path «Раздел / Подраздел»: the database finds or creates it */
  category?: string | null;
  category_id?: Identifier | null;
  price?: number | null;
  position: number;
  unit?: Service["unit"];
  duration_minutes?: number | null;
  specialty?: string | null;
  materials_note?: string | null;
  is_archived?: boolean;
};

/** A cost price (public.service_costs: the owner and the head only) */
export type ServiceCost = {
  id: Identifier;
  service_id: Identifier;
  cost_price: number;
  updated_by?: Identifier | null;
  updated_at?: string;
};
