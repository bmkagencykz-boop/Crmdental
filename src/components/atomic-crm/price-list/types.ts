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
