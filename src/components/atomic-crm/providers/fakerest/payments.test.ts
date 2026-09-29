import { beforeAll, describe, expect, it } from "vitest";

import type { Deal, DealPayment, Sale } from "../../types";
import type {
  AccountOperation,
  CashShift,
  PatientAccount,
} from "../../payments/types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
}, 120_000);

const setup = () => {
  const db = generateData();
  let current: Sale = db.sales.find((sale) => sale.role === "owner")!;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({
        id: current.id,
        fullName: current.first_name,
      }),
    },
  });
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role && !sale.disabled)!;
    return current;
  };
  return { db, dataProvider, loginAs };
};

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList(resource, {
      filter,
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const paidOfDeal = async (dataProvider: CrmDataProvider, id: Deal["id"]) =>
  (await dataProvider.getOne<Deal>("deals", { id })).data.paid_amount;

describe("demo payments", () => {
  it("generates a ledger in sync with the deal payments", () => {
    const { db } = setup();
    // Every deal payment has its ledger row and the paid amounts agree
    for (const payment of db.deal_payments) {
      expect(
        db.account_operations.filter((op) => op.deal_payment_id === payment.id),
      ).toHaveLength(1);
    }
    for (const deal of db.deals) {
      const sum = db.deal_payments
        .filter((p) => p.deal_id === deal.id)
        .reduce((s, p) => s + p.amount, 0);
      expect(deal.paid_amount).toBe(sum);
    }
    const kinds = new Set(db.account_operations.map((op) => op.kind));
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        "payment",
        "deposit",
        "deposit_payment",
        "refund",
      ]),
    );
    const methods = new Set(db.account_operations.map((op) => op.method));
    expect([...methods]).toEqual(
      expect.arrayContaining(["cash", "card", "kaspi_qr", "mixed"]),
    );
    expect(db.cash_shifts.filter((s) => s.closed_at)).toHaveLength(1);
    expect(db.cash_shifts.filter((s) => !s.closed_at)).toHaveLength(1);
  });

  it("reads the journal with the names, like the SQL view", async () => {
    const { dataProvider } = setup();
    const rows = await list<Record<string, unknown>>(
      dataProvider,
      "account_operations_summary",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.patient_name === "string")).toBe(
      true,
    );
    expect(rows.some((row) => row.cashier_name)).toBe(true);
  });

  it("has debtors", async () => {
    const { dataProvider } = setup();
    const debtors = await list<PatientAccount>(
      dataProvider,
      "patient_accounts",
      {
        "debt@gt": 0,
      },
    );
    expect(debtors.length).toBeGreaterThanOrEqual(3);
  });

  it("writes the deal payment of an operation, and back", async () => {
    const { db, dataProvider } = setup();
    const deal = db.deals.find((d) => !d.archived_at)!;
    const before = await paidOfDeal(dataProvider, deal.id);
    const { data: op } = await dataProvider.create<AccountOperation>(
      "account_operations",
      {
        data: {
          patient_id: deal.patient_id,
          kind: "payment",
          amount: 30000,
          method: "mixed",
          parts: [
            { method: "cash", amount: 10000 },
            { method: "card", amount: 20000 },
          ],
          cash_received: 15000,
          // A form sends the ids as strings
          deal_id: String(deal.id),
          comment: "тест",
        },
      },
    );
    expect(op.deal_payment_id).not.toBeNull();
    expect(op.paid_delta).toBe(30000);
    expect(await paidOfDeal(dataProvider, deal.id)).toBe(before + 30000);

    // A refund to the deposit: a negative deal payment, the deposit grows
    await dataProvider.create("account_operations", {
      data: {
        patient_id: deal.patient_id,
        kind: "refund",
        account: "services",
        amount: 5000,
        method: "deposit",
        deal_id: deal.id,
      },
    });
    expect(await paidOfDeal(dataProvider, deal.id)).toBe(before + 25000);
    const payments = await list<DealPayment>(dataProvider, "deal_payments", {
      deal_id: deal.id,
    });
    expect(payments.some((p) => p.amount === -5000)).toBe(true);

    // Cancelling the payment takes its deal payment
    await dataProvider.delete("account_operations", {
      id: op.id,
      previousData: op,
    });
    expect(await paidOfDeal(dataProvider, deal.id)).toBe(before - 5000);

    // A deal payment written directly gets its ledger row
    const { data: direct } = await dataProvider.create<DealPayment>(
      "deal_payments",
      { data: { deal_id: deal.id, amount: 7000, paid_at: "2026-01-01" } },
    );
    const mirror = (
      await list<AccountOperation>(dataProvider, "account_operations")
    ).find((row) => row.deal_payment_id === direct.id);
    expect(mirror?.method).toBe("other");
    expect(mirror?.source).toBe("deal");
  });

  it("refuses beyond the deposit and keeps refunds for the owner and the head", async () => {
    const { db, dataProvider, loginAs } = setup();
    const patient = db.patients[0];
    await expect(
      dataProvider.create("account_operations", {
        data: {
          patient_id: patient.id,
          kind: "deposit_payment",
          amount: 10_000_000,
        },
      }),
    ).rejects.toThrow(/депозите/);
    loginAs("manager");
    await expect(
      dataProvider.create("account_operations", {
        data: {
          patient_id: patient.id,
          kind: "refund",
          account: "deposit",
          amount: 100,
          method: "cash",
        },
      }),
    ).rejects.toThrow(/Возврат/);
  });

  it("opens and closes a shift: expected against counted", async () => {
    const { db, dataProvider, loginAs } = setup();
    const manager = loginAs("manager");
    // The demo cashier already has today's shift
    const open = db.cash_shifts.find(
      (s) => s.sales_id === manager.id && !s.closed_at,
    );
    if (open) {
      const expected = await dataProvider.cashShiftExpected(open.id);
      const result = await dataProvider.closeCashShift(open.id, expected + 100);
      expect(result.discrepancy).toBe(100);
    }
    const id = await dataProvider.openCashShift(5000);
    await expect(dataProvider.openCashShift(0)).rejects.toThrow(/уже открыта/);
    const patient = db.patients[1];
    await dataProvider.create("account_operations", {
      data: {
        patient_id: patient.id,
        kind: "deposit",
        amount: 8000,
        method: "cash",
      },
    });
    expect(await dataProvider.cashShiftExpected(id)).toBe(13000);
    const shifts = await list<CashShift>(dataProvider, "cash_shifts");
    expect(shifts.every((s) => s.sales_id === manager.id)).toBe(true);
  });
});
